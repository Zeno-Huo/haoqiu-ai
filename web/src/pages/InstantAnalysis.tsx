import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { CloudDetectionJob } from '../cloudDetectionTypes'
import {
  createInstantAnalysisJob,
  getInstantAnalysisJob,
  isCloudDetectionConfigured,
} from '../lib/cloudDetectionApi'
import { ensureUploadedVideo, UPLOAD_PHASE_LABELS } from '../lib/cloudUploadWorkflow'
import type { UploadPhase } from '../lib/cloudUploadWorkflow'
import { getMatch, saveMatch } from '../lib/storage'
import { getCachedVideoFile } from '../lib/videoFileCache'
import { parseInstantAnalysis } from '../lib/instantAnalysis'
import InstantDashboard from '../components/InstantDashboard'
import { setAnalysisMode } from '../lib/analysisMode'

/** 即时分析：整段视频直传 COS 后交给视觉大模型出文字复盘。 */
async function ensureInstantWorkflow(
  matchId: string,
  file: File | undefined,
  teamContext: NonNullable<ReturnType<typeof getMatch>>['ourTeamContext'],
  listener: (phase: UploadPhase, progress: number) => void,
): Promise<CloudDetectionJob> {
  const uploadId = await ensureUploadedVideo(matchId, file, listener)
  const job = await createInstantAnalysisJob(uploadId, matchId, teamContext ? {
    team_name: teamContext.teamName,
    jersey_hint: teamContext.jerseyHint,
    opening_frame_point: teamContext.openingFramePoint,
  } : undefined)
  const latest = getMatch(matchId)
  if (latest) saveMatch({ ...latest, cloudUploadId: uploadId, instantJobId: job.job_id, instantAnalysisJob: job })
  return job
}

/** 兼容旧版 VLM 文字结果；新版优先渲染结构化看板。 */
function renderReport(content: string) {
  const blocks = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const source = blocks.length > 0 ? blocks : [content.trim()]
  return source.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const bulletLines = lines.filter((line) => /^[-·•*\d]/.test(line))
    if (lines.length > 1 && bulletLines.length === lines.length) {
      return (
        <ul key={index} className="space-y-2 text-sm leading-7 text-[var(--text-secondary)]">
          {lines.map((line, i) => <li key={i}>{line.replace(/^[-·•*]\s*/, '· ')}</li>)}
        </ul>
      )
    }
    const heading = lines.length > 1 && lines[0].length <= 20 && /[：:]$/.test(lines[0])
    return (
      <div key={index} className="space-y-2">
        {heading && <p className="text-sm font-semibold text-[var(--text-primary)]">{lines[0].replace(/[：:]$/, '')}</p>}
        {(heading ? lines.slice(1) : lines).map((line, i) => (
          <p key={i} className="text-sm leading-7 text-[var(--text-secondary)]">{line.replace(/^[-·•*]\s*/, '· ')}</p>
        ))}
      </div>
    )
  })
}

export default function InstantAnalysis() {
  const { id } = useParams()
  const navigate = useNavigate()
  const initialMatch = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [job, setJob] = useState<CloudDetectionJob | undefined>(initialMatch?.instantAnalysisJob)
  const [phase, setPhase] = useState<UploadPhase>('ticket')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const configured = isCloudDetectionConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    const match = initialMatch
    let cancelled = false
    let timer: number | undefined

    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.instantJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) {
            setMessage('本地视频文件已在刷新后丢失。云端上传尚未完成，请重新选择视频。')
            return
          }
          const created = await ensureInstantWorkflow(match.id, file, latest.ourTeamContext, (nextPhase, progress) => {
            if (cancelled) return
            setPhase(nextPhase)
            setUploadProgress(progress)
          })
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
        }

        async function poll() {
          if (!jobId || cancelled) return
          try {
            const current = await getInstantAnalysisJob(jobId)
            if (cancelled) return
            setJob(current)
            setMessage('')
            const currentMatch = getMatch(match.id) ?? match
            saveMatch({ ...currentMatch, instantJobId: current.job_id, instantAnalysisJob: current })
            if (current.status === 'succeeded' || current.status === 'failed') return
            timer = window.setTimeout(poll, 3000)
          } catch (error) {
            if (cancelled) return
            setMessage(error instanceof Error ? error.message : '暂时无法获取即时分析进度，请稍后重试。')
          }
        }
        await poll()
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : '视频上传或即时分析任务创建失败，请重试。')
      }
    }

    void run()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [configured, initialMatch, retryNonce])

  if (!initialMatch) {
    return <div className="page-shell grid place-items-center px-4"><section className="panel max-w-md p-6 text-center"><p className="text-[var(--text-secondary)]">找不到这段视频记录。</p><Link className="btn-primary mt-5" to="/match/new">重新选择视频</Link></section></div>
  }

  const persistedMatch = getMatch(initialMatch.id) ?? initialMatch
  const success = job?.status === 'succeeded'
  const failed = job?.status === 'failed'
  const parsed = job ? parseInstantAnalysis(job) : {}
  const progress = job ? Math.min(100, Math.max(0, job.progress)) : uploadProgress
  const stageLabel = job
    ? (job.status === 'queued' ? '等待视觉模型排队' : job.status === 'running' ? '视觉模型正在阅读比赛画面' : '即时分析处理中')
    : UPLOAD_PHASE_LABELS[phase]
  const fileStillAvailable = Boolean(getCachedVideoFile(initialMatch.id))

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <p className="eyebrow">即时分析 · 视觉大模型</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{success ? '即时分析已完成' : failed ? '即时分析失败' : '正在快速阅读比赛画面'}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">快速统计比赛数据，辅助教练在比赛中决策。输出为模型对画面的文字判断，不是逐帧精确统计。</p>
        </header>

        {!configured ? (
          <section className="panel p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">分析暂时不可用</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">分析没有完成，请再试一次。</p>
            <div className="mt-6 flex flex-wrap gap-3"><Link className="btn-secondary" to={'/match/' + initialMatch.id + '/quality'}>返回画面检查</Link></div>
          </section>
        ) : (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p>
                <p className="mt-1 font-score text-xs text-[var(--text-muted)]">{job?.job_id ? '任务 ' + job.job_id : persistedMatch.cloudUploadId ? '完整视频已上传' : '等待安全上传信息'}</p>
              </div>
              <span className="status-text"><span className="status-dot" />{job?.status ?? phase}</span>
            </div>

            {!success && !failed && (
              <>
                <div className="mt-7 h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-300" style={{ width: progress + '%' }} /></div>
                <div className="mt-3 flex justify-between gap-3 text-sm text-[var(--text-secondary)]"><span>{stageLabel}</span><b className="font-score text-[var(--ai)]">{progress}%</b></div>
              </>
            )}

            {message && (
              <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4">
                <p className="text-sm leading-6 text-[var(--attack)]">{message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {persistedMatch.instantJobId || job?.job_id
                    ? <button className="btn-secondary" onClick={() => setRetryNonce((value) => value + 1)}>重试查询</button>
                    : persistedMatch.cloudUploadId
                      ? <button className="btn-secondary" onClick={() => setRetryNonce((value) => value + 1)}>重试创建任务</button>
                      : fileStillAvailable
                        ? <button className="btn-secondary" onClick={() => setRetryNonce((value) => value + 1)}>重试视频上传</button>
                        : <Link className="btn-secondary" to="/match/new">重新选择视频</Link>}
                  <Link className="btn-secondary" to={'/match/' + initialMatch.id + '/quality'}>返回画面检查</Link>
                </div>
              </div>
            )}

            {failed && (
              <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4">
                <p className="font-medium text-[var(--danger)]">{job.error?.message || '即时分析未能完成'}</p>
                {job.error?.code && <p className="mt-2 font-score text-xs text-[var(--text-muted)]">{job.error.code}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link className="btn-secondary" to="/match/new">重新选择视频</Link>
                  <button className="btn-secondary" onClick={() => navigate('/match/' + initialMatch.id + '/detection')}>改用深度复盘</button>
                </div>
              </div>
            )}

            {success && (
              <div className="mt-6 space-y-5">
                <dl className="grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
                  <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">复盘状态</dt><dd className="mt-2 text-sm font-medium text-[var(--text-primary)]">已准备</dd></div>
                  <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">数据边界</dt><dd className="mt-2 text-sm font-medium text-[var(--text-primary)]">结果仅供参考</dd></div>
                </dl>

                {job.warnings && job.warnings.length > 0 && (
                  <div className="rounded-md border border-[var(--attack)] bg-[var(--content)] p-4">
                    <p className="text-sm font-medium text-[var(--attack)]">分析提示</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">{job.warnings.map((warning) => <li key={warning}>· {warning}</li>)}</ul>
                  </div>
                )}

                {parsed.dashboard
                  ? <InstantDashboard dashboard={parsed.dashboard} />
                  : <div className="rounded-md border border-[var(--line)] bg-[var(--content)] p-5"><h2 className="text-base font-semibold text-[var(--text-primary)]">结构化看板尚未返回</h2><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">模型任务已完成，但当前服务只返回文字复盘，尚未提供比分、控球、射门、球队数据和球员卡字段。</p>{parsed.narrative && <div className="mt-5 space-y-4">{renderReport(parsed.narrative)}</div>}</div>}
                <p className="text-xs leading-5 text-[var(--text-muted)]">以上结论由视觉大模型根据画面推断，可能存在误判；需要逐帧标注视频请使用深度复盘。</p>
              </div>
            )}

            <div className="mt-7 border-t border-[var(--line)] pt-5">
              <p className="text-xs leading-5 text-[var(--text-muted)]">深度复盘会对同一段视频做 GPU 逐帧检测并生成标注视频，耗时更长。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => navigate('/match/' + initialMatch.id + '/detection')}>进入深度复盘</button>
                <button className="btn-secondary" onClick={() => { setAnalysisMode('demo'); navigate('/match/' + initialMatch.id + '/analyzing') }}>切换到演示模式</button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
