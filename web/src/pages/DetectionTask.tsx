import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { DetectionJob, DetectionJobStage } from '../detectionTypes'
import { createDetectionJob, getDetectionJob, isDetectionServiceConfigured, resolveDetectionArtifactUrl } from '../lib/detectionApi'
import { getMatch, saveMatch } from '../lib/storage'
import { clearCachedVideoFile, getCachedVideoFile } from '../lib/videoFileCache'

const creationByMatch = new Map<string, Promise<DetectionJob>>()

function createAndPersist(matchId: string, file: File): Promise<DetectionJob> {
  const existing = creationByMatch.get(matchId)
  if (existing) return existing
  const request = createDetectionJob(file, matchId).then((job) => {
    const latest = getMatch(matchId)
    if (latest) saveMatch({ ...latest, detectionJobId: job.job_id, detectionJob: job })
    return job
  }).finally(() => creationByMatch.delete(matchId))
  creationByMatch.set(matchId, request)
  return request
}

const STAGE_LABELS: Record<DetectionJobStage, string> = {
  queued: '等待 GPU 任务',
  probing: '读取视频信息',
  detecting: '正在检测画面中的球员候选',
  rendering: '正在生成带检测框视频',
  completed: '检测已完成',
  failed: '检测失败',
}

function inputDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

export default function DetectionTask() {
  const { id } = useParams()
  const navigate = useNavigate()
  const initialMatch = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [job, setJob] = useState<DetectionJob | undefined>(initialMatch?.detectionJob)
  const [message, setMessage] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const configured = isDetectionServiceConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    const match = initialMatch
    let cancelled = false
    let timer: number | undefined

    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.detectionJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!file) {
            setMessage('本地视频文件已在刷新后丢失。真实检测尚未开始，请重新选择视频。')
            return
          }
          setMessage('正在上传视频并创建真实检测任务…')
          const created = await createAndPersist(match.id, file)
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
        }

        async function poll() {
          if (!jobId || cancelled) return
          try {
            const current = await getDetectionJob(jobId)
            if (cancelled) return
            setJob(current)
            setMessage('')
            const currentMatch = getMatch(match.id) ?? match
            saveMatch({ ...currentMatch, detectionJobId: current.job_id, detectionJob: current })
            if (current.status === 'succeeded') clearCachedVideoFile(match.id)
            if (current.status === 'queued' || current.status === 'running') {
              timer = window.setTimeout(poll, 1500)
            }
          } catch (error) {
            if (cancelled) return
            setMessage(error instanceof Error ? error.message : '暂时无法获取检测进度，请稍后重试。')
          }
        }
        await poll()
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : '真实检测任务创建失败，请重试。')
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

  const terminalFailure = job?.status === 'failed'
  const success = job?.status === 'succeeded'
  const progress = Math.min(100, Math.max(0, job?.progress ?? 0))
  const stageLabel = job?.stage ? STAGE_LABELS[job.stage] : job?.status === 'queued' ? STAGE_LABELS.queued : '正在创建任务'
  const fileStillAvailable = Boolean(getCachedVideoFile(initialMatch.id))

  function retry() {
    setMessage('')
    setRetryNonce((value) => value + 1)
  }

  function submitAgain() {
    if (!initialMatch) return
    if (!fileStillAvailable) {
      navigate('/match/new')
      return
    }
    const latest = getMatch(initialMatch.id) ?? initialMatch
    saveMatch({ ...latest, detectionJobId: undefined, detectionJob: undefined })
    setJob(undefined)
    setMessage('')
    setRetryNonce((value) => value + 1)
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <p className="eyebrow">真实检测任务</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{success ? '真实检测任务已完成' : terminalFailure ? '真实检测任务失败' : '正在检测画面中的球员候选'}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">此处只展示球员检测模型结果，不生成比分、控球率、传球、抢断或球员身份。</p>
        </header>

        {!configured ? (
          <section className="panel p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">未配置真实检测服务</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">请配置 VITE_DETECTION_API_BASE 后重新启动网页。前端不会保存 API Token，也没有写死公网地址。</p>
            <div className="mt-6 flex flex-wrap gap-3"><Link className="btn-secondary" to={`/match/${initialMatch.id}/quality`}>返回画面检查</Link><button className="btn-primary" onClick={() => navigate(`/match/${initialMatch.id}/analyzing`)}>查看球队复盘 Demo</button></div>
          </section>
        ) : (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p>
                <p className="mt-1 font-score text-xs text-[var(--text-muted)]">{job?.job_id ? `任务 ${job.job_id}` : '等待任务编号'}</p>
              </div>
              <span className="status-text"><span className="status-dot" />{job?.status ?? 'preparing'}</span>
            </div>

            {!success && !terminalFailure && (
              <>
                <div className="mt-7 h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
                <div className="mt-3 flex justify-between gap-3 text-sm text-[var(--text-secondary)]"><span>{stageLabel}</span><b className="font-score text-[var(--ai)]">{progress}%</b></div>
              </>
            )}

            {message && (
              <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4">
                <p className="text-sm leading-6 text-[var(--attack)]">{message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {initialMatch.detectionJobId || job?.job_id ? <button className="btn-secondary" onClick={retry}>重试查询</button> : fileStillAvailable ? <button className="btn-secondary" onClick={retry}>重试提交</button> : <Link className="btn-secondary" to="/match/new">重新选择视频</Link>}
                  <Link className="btn-secondary" to={`/match/${initialMatch.id}/quality`}>返回画面检查</Link>
                </div>
              </div>
            )}

            {terminalFailure && (
              <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4">
                <p className="font-medium text-[var(--danger)]">{job.error?.message || '检测任务未能完成'}</p>
                {job.error?.code && <p className="mt-2 font-score text-xs text-[var(--text-muted)]">{job.error.code}</p>}
                <button className="btn-secondary mt-4" onClick={submitAgain}>{fileStillAvailable ? '重新提交检测' : '重新选择视频'}</button>
              </div>
            )}

            {success && (
              <div className="mt-6 space-y-5">
                <dl className="grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
                  <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">模型</dt><dd className="mt-2 text-sm font-medium text-[var(--text-primary)]">{job.model?.name ?? '未返回'}</dd><dd className="mt-1 font-score text-xs text-[var(--text-muted)]">{job.model?.version ?? '版本未返回'}</dd></div>
                  <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">输入视频</dt><dd className="mt-2 text-sm font-medium text-[var(--text-primary)]">{job.input?.filename ?? initialMatch.videoName}</dd><dd className="mt-1 font-score text-xs text-[var(--text-muted)]">{job.input ? `${inputDuration(job.input.duration_seconds)} · ${job.input.width}×${job.input.height} · ${job.input.fps} fps` : '元数据未返回'}</dd></div>
                </dl>

                {job.warnings && job.warnings.length > 0 && <div className="rounded-md border border-[var(--attack)] bg-[var(--content)] p-4"><p className="text-sm font-medium text-[var(--attack)]">检测警告</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">{job.warnings.map((warning) => <li key={warning}>· {warning}</li>)}</ul></div>}

                {job.artifacts?.annotated_video_url ? (
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">查看检测视频</h2>
                    <video className="mt-3 w-full rounded-md border border-[var(--line)] bg-black" controls preload="metadata" src={resolveDetectionArtifactUrl(job.artifacts.annotated_video_url)}>当前浏览器无法播放检测视频。</video>
                  </div>
                ) : <p className="rounded-md border border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">任务已完成，但服务未返回带检测框视频地址。</p>}
              </div>
            )}

            <div className="mt-7 border-t border-[var(--line)] pt-5">
              <p className="text-xs leading-5 text-[var(--text-muted)]">球队复盘 Demo 与真实检测结果相互独立；Demo 中的比分、控球、射门和球员数据不是本次模型输出。</p>
              <button className="btn-secondary mt-3" onClick={() => navigate(`/match/${initialMatch.id}/analyzing`)}>查看球队复盘 Demo</button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
