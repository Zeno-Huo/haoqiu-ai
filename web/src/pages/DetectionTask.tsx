import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { CloudDetectionJob, SignedDetectionVideo } from '../cloudDetectionTypes'
import type { DetectionJobStage } from '../detectionTypes'
import {
  createCloudDetectionJob,
  getCloudDetectionJob,
  getSignedDetectionVideo,
  isCloudDetectionConfigured,
} from '../lib/cloudDetectionApi'
import { getMatch, saveMatch } from '../lib/storage'
import { getCachedVideoFile } from '../lib/videoFileCache'
import { ensureUploadedVideo, UPLOAD_PHASE_LABELS } from '../lib/cloudUploadWorkflow'
import type { UploadPhase } from '../lib/cloudUploadWorkflow'

type WorkflowPhase = UploadPhase

function safeJobSnapshot(job: CloudDetectionJob): CloudDetectionJob {
  return {
    ...job,
    artifacts: job.artifacts ? { annotated_video_ready: Boolean(job.artifacts.annotated_video_ready) } : undefined,
  }
}

/** 深度复盘：整段视频直传 COS 后创建 GPU 检测任务。 */
async function ensureCloudWorkflow(
  matchId: string,
  file: File | undefined,
  listener: (phase: WorkflowPhase, progress: number) => void,
): Promise<CloudDetectionJob> {
  const uploadId = await ensureUploadedVideo(matchId, file, listener)
  const job = await createCloudDetectionJob(uploadId, matchId)
  const latest = getMatch(matchId)
  if (latest) saveMatch({ ...latest, cloudUploadId: uploadId, cloudJobId: job.job_id, cloudDetectionJob: safeJobSnapshot(job) })
  return job
}

const STAGE_LABELS: Record<DetectionJobStage, string> = {
  queued: '等待 GPU 任务',
  probing: '读取完整视频信息',
  detecting: '正在检测画面中的球员候选',
  rendering: '正在生成检测视频',
  completed: '深度复盘已完成',
  failed: '深度复盘失败',
}

const WORKFLOW_LABELS: Record<WorkflowPhase, string> = UPLOAD_PHASE_LABELS

function inputDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60).toString().padStart(2, '0')
  return minutes + ':' + rest
}

export default function DetectionTask() {
  const { id } = useParams()
  const navigate = useNavigate()
  const initialMatch = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [job, setJob] = useState<CloudDetectionJob | undefined>(initialMatch?.cloudDetectionJob)
  const [workflowPhase, setWorkflowPhase] = useState<WorkflowPhase>('ticket')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [resultMessage, setResultMessage] = useState('')
  const [resultVideo, setResultVideo] = useState<SignedDetectionVideo>()
  const [retryNonce, setRetryNonce] = useState(0)
  const configured = isCloudDetectionConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    const match = initialMatch
    let cancelled = false
    let timer: number | undefined

    async function loadResult(jobId: string) {
      try {
        const signed = await getSignedDetectionVideo(jobId)
        if (cancelled) return
        setResultVideo(signed)
        setResultMessage('')
      } catch (error) {
        if (cancelled) return
        setResultMessage(error instanceof Error ? error.message : '暂时无法取得检测视频播放地址')
      }
    }

    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.cloudJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) {
            setMessage('本地视频文件已在刷新后丢失。云端上传尚未完成，请重新选择视频。')
            return
          }
          const created = await ensureCloudWorkflow(match.id, file, (phase, progress) => {
            if (cancelled) return
            setWorkflowPhase(phase)
            setUploadProgress(progress)
          })
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
        }

        async function poll() {
          if (!jobId || cancelled) return
          try {
            const current = await getCloudDetectionJob(jobId)
            if (cancelled) return
            setJob(current)
            setMessage('')
            const currentMatch = getMatch(match.id) ?? match
            saveMatch({ ...currentMatch, cloudJobId: current.job_id, cloudDetectionJob: safeJobSnapshot(current) })
            if (current.status === 'succeeded') {
              if (current.artifacts?.annotated_video_ready) await loadResult(current.job_id)
              return
            }
            if (current.status === 'queued' || current.status === 'running') timer = window.setTimeout(poll, 2000)
          } catch (error) {
            if (cancelled) return
            setMessage(error instanceof Error ? error.message : '暂时无法获取云检测进度，请稍后重试。')
          }
        }
        await poll()
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : '完整视频上传或云检测任务创建失败，请重试。')
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
  const terminalFailure = job?.status === 'failed'
  const success = job?.status === 'succeeded'
  const progress = job ? Math.min(100, Math.max(0, job.progress)) : uploadProgress
  const stageLabel = job
    ? (job.stage ? STAGE_LABELS[job.stage] : job.status === 'queued' ? STAGE_LABELS.queued : '云检测任务处理中')
    : WORKFLOW_LABELS[workflowPhase]
  const fileStillAvailable = Boolean(getCachedVideoFile(initialMatch.id))

  function retry() {
    setMessage('')
    setRetryNonce((value) => value + 1)
  }

  async function refreshResultUrl() {
    const jobId = job?.job_id || persistedMatch.cloudJobId
    if (!jobId) return
    try {
      setResultMessage('正在刷新检测视频播放地址…')
      const signed = await getSignedDetectionVideo(jobId)
      setResultVideo(signed)
      setResultMessage('')
    } catch (error) {
      setResultMessage(error instanceof Error ? error.message : '刷新检测视频播放地址失败')
    }
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <p className="eyebrow">深度复盘 · GPU 逐帧检测</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{success ? '深度复盘已完成' : terminalFailure ? '深度复盘失败' : '正在检测画面中的球员候选'}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">分析时间较长，仅适用赛后复盘以及球员成长。完整视频直传私有存储；此处不生成比分、控球率、传球、抢断或球员身份。</p>
        </header>

        {!configured ? (
          <section className="panel p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">未配置云端分析服务</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">当前网页未指向可用的 CloudBase 云函数。前端不会保存 COS 密钥或长期令牌。</p>
            <div className="mt-6 flex flex-wrap gap-3"><Link className="btn-secondary" to={'/match/' + initialMatch.id + '/quality'}>返回画面检查</Link><button className="btn-primary" onClick={() => navigate('/match/' + initialMatch.id + '/analyzing')}>查看球队复盘 Demo</button></div>
          </section>
        ) : (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p>
                <p className="mt-1 font-score text-xs text-[var(--text-muted)]">{job?.job_id ? '任务 ' + job.job_id : persistedMatch.cloudUploadId ? '完整视频已上传' : '等待安全上传信息'}</p>
              </div>
              <span className="status-text"><span className="status-dot" />{job?.status ?? workflowPhase}</span>
            </div>

            {!success && !terminalFailure && (
              <>
                <div className="mt-7 h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-300" style={{ width: progress + '%' }} /></div>
                <div className="mt-3 flex justify-between gap-3 text-sm text-[var(--text-secondary)]"><span>{stageLabel}</span><b className="font-score text-[var(--ai)]">{progress}%</b></div>
              </>
            )}

            {message && (
              <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4">
                <p className="text-sm leading-6 text-[var(--attack)]">{message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {persistedMatch.cloudJobId || job?.job_id ? <button className="btn-secondary" onClick={retry}>重试查询</button> : persistedMatch.cloudUploadId ? <button className="btn-secondary" onClick={retry}>重试创建任务</button> : fileStillAvailable ? <button className="btn-secondary" onClick={retry}>重试完整视频上传</button> : <Link className="btn-secondary" to="/match/new">重新选择视频</Link>}
                  <Link className="btn-secondary" to={'/match/' + initialMatch.id + '/quality'}>返回画面检查</Link>
                </div>
              </div>
            )}

            {terminalFailure && (
              <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4">
                <p className="font-medium text-[var(--danger)]">{job.error?.message || '云检测任务未能完成'}</p>
                {job.error?.code && <p className="mt-2 font-score text-xs text-[var(--text-muted)]">{job.error.code}</p>}
                <Link className="btn-secondary mt-4" to="/match/new">重新选择视频</Link>
              </div>
            )}

            {success && (
              <div className="mt-6 space-y-5">
                <dl className="grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
                  <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">模型</dt><dd className="mt-2 text-sm font-medium text-[var(--text-primary)]">{job.model?.name ?? '未返回'}</dd><dd className="mt-1 font-score text-xs text-[var(--text-muted)]">{job.model?.version ?? '版本未返回'}</dd></div>
                  <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">输入视频</dt><dd className="mt-2 text-sm font-medium text-[var(--text-primary)]">{job.input?.filename ?? initialMatch.videoName}</dd><dd className="mt-1 font-score text-xs text-[var(--text-muted)]">{job.input ? inputDuration(job.input.duration_seconds) + ' · ' + job.input.width + '×' + job.input.height + ' · ' + job.input.fps + ' fps' : '元数据未返回'}</dd></div>
                </dl>

                {job.warnings && job.warnings.length > 0 && <div className="rounded-md border border-[var(--attack)] bg-[var(--content)] p-4"><p className="text-sm font-medium text-[var(--attack)]">检测警告</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">{job.warnings.map((warning) => <li key={warning}>· {warning}</li>)}</ul></div>}

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-[var(--text-primary)]">查看检测视频</h2><button className="text-sm text-[var(--ai)] hover:underline" type="button" onClick={() => void refreshResultUrl()}>刷新播放地址</button></div>
                  {resultVideo ? <video key={resultVideo.url} className="mt-3 w-full rounded-md border border-[var(--line)] bg-black" controls preload="metadata" src={resultVideo.url} onError={() => setResultMessage('短期播放地址可能已失效，请刷新播放地址。')}>当前浏览器无法播放检测视频。</video> : job.artifacts?.annotated_video_ready ? <p className="mt-3 rounded-md border border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">正在取得短期检测视频播放地址…</p> : <p className="mt-3 rounded-md border border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">任务已完成，但服务尚未标记检测视频可用。请稍后重试查询。</p>}
                  {resultVideo && <p className="mt-2 text-xs text-[var(--text-muted)]">播放地址为短期授权，不会保存在本地记录中；到期后可刷新。</p>}
                  {resultMessage && <p className="mt-2 text-sm text-[var(--attack)]">{resultMessage}</p>}
                </div>
              </div>
            )}

            <div className="mt-7 border-t border-[var(--line)] pt-5">
              <p className="text-xs leading-5 text-[var(--text-muted)]">球队复盘 Demo 与云检测结果相互独立；Demo 中的比分、控球、射门和球员数据不是本次模型输出。</p>
              <button className="btn-secondary mt-3" onClick={() => navigate('/match/' + initialMatch.id + '/analyzing')}>查看球队复盘 Demo</button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
