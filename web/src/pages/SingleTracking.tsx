import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CloudDetectionJob, SignedDetectionVideo } from '../cloudDetectionTypes'
import { createCloudDetectionJob, getCloudDetectionJob, getSignedDetectionVideo, isCloudDetectionConfigured } from '../lib/cloudDetectionApi'
import { ensureUploadedVideo, UPLOAD_PHASE_LABELS, type UploadPhase } from '../lib/cloudUploadWorkflow'
import { getCachedVideoFile } from '../lib/videoFileCache'
import { getMatch, saveMatch } from '../lib/storage'
import { buildDetectionStats } from '../lib/detectionStats'

type Candidate = { id: string; title: string; clue: string }

function candidatesFor(job?: CloudDetectionJob): Candidate[] {
  const count = Math.max(1, Math.min(4, Math.round((job?.diagnostics?.frame_detections_by_class?.player ?? 0) / 80) || 3))
  return Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index + 1}`,
    title: `候选 ${String(index + 1).padStart(2, '0')}`,
    clue: index === 0 ? '画面出现较稳定' : '在多个画面中出现',
  }))
}

export default function SingleTracking() {
  const { id } = useParams()
  const initialMatch = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [job, setJob] = useState<CloudDetectionJob | undefined>(initialMatch?.trackingDetectionJob)
  const [phase, setPhase] = useState<UploadPhase>('ticket')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [resultVideo, setResultVideo] = useState<SignedDetectionVideo>()
  const [selected, setSelected] = useState(initialMatch?.trackingCandidateId || '')
  const configured = isCloudDetectionConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    let cancelled = false
    let timer: number | undefined
    const match = initialMatch

    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.trackingJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) throw new Error('本地视频文件已在刷新后丢失，请重新选择视频。')
          const uploadId = await ensureUploadedVideo(match.id, file, (next, progress) => {
            if (!cancelled) { setPhase(next); setUploadProgress(progress) }
          })
          const created = await createCloudDetectionJob(uploadId, match.id, 'single')
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
          saveMatch({ ...latest, cloudUploadId: uploadId, trackingJobId: jobId, trackingDetectionJob: created })
        }
        async function poll() {
          if (!jobId || cancelled) return
          const current = await getCloudDetectionJob(jobId)
          if (cancelled) return
          setJob(current)
          const currentMatch = getMatch(match.id) ?? match
          saveMatch({ ...currentMatch, trackingJobId: current.job_id, trackingDetectionJob: current })
          if (current.status === 'succeeded') {
            if (current.artifacts?.annotated_video_ready) {
              const signed = await getSignedDetectionVideo(current.job_id)
              if (!cancelled) setResultVideo(signed)
            }
            return
          }
          if (current.status !== 'failed') timer = window.setTimeout(poll, 2000)
        }
        await poll()
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '单人跟拍任务创建失败，请重新选择视频。')
      }
    }
    void run()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [configured, initialMatch])

  if (!initialMatch) return <div className="page-shell grid place-items-center px-4"><section className="panel max-w-md p-6 text-center"><p className="text-[var(--text-secondary)]">找不到这段单人跟拍记录。</p><Link className="btn-primary mt-5" to="/match/new?mode=single">重新选择视频</Link></section></div>
  const matchRecord = initialMatch

  const success = job?.status === 'succeeded'
  const failed = job?.status === 'failed'
  const progress = job ? job.progress : uploadProgress
  const detection = job ? buildDetectionStats(job) : undefined
  const candidates = candidatesFor(job)
  const stage = job?.stage === 'detecting' ? '正在找出画面中的你' : job?.stage === 'rendering' ? '正在整理个人片段' : job?.status === 'queued' ? '正在等待分析' : job ? '正在分析个人表现' : UPLOAD_PHASE_LABELS[phase]

  function confirmCandidate(candidateId: string) {
    setSelected(candidateId)
    const latest = getMatch(matchRecord.id) ?? matchRecord
    saveMatch({ ...latest, trackingCandidateId: candidateId })
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7">
          <p className="eyebrow">个人比赛</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{success ? '确认画面中的你' : failed ? '分析没有完成' : '正在找出画面中的你'}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">确认后，我们会围绕这一名球员整理表现。</p>
        </header>

        {!configured ? <section className="panel p-6"><h2 className="text-lg font-semibold text-[var(--text-primary)]">个人分析暂时不可用</h2><Link className="btn-primary mt-5" to="/match/new?mode=single">重新选择视频</Link></section> : (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p></div><span className="status-text"><span className="status-dot" />{success ? '已完成' : '分析中'}</span></div>
            {!success && !failed && <><div className="mt-7 h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div><div className="mt-3 flex justify-between text-sm text-[var(--text-secondary)]"><span>{stage}</span><b className="font-score text-[var(--ai)]">{progress}%</b></div></>}
            {message && <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4 text-sm text-[var(--attack)]">{message}<Link className="btn-secondary mt-4" to="/match/new?mode=single">重新选择视频</Link></div>}
            {failed && <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4"><p className="text-sm text-[var(--danger)]">{job?.error?.message || '个人分析没有完成'}</p><Link className="btn-secondary mt-4" to="/match/new?mode=single">重新选择视频</Link></div>}
            {success && <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
              <div className="rounded-md border border-[var(--line)] bg-[var(--content)] p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-[var(--text-primary)]">比赛画面</h2></div>{resultVideo ? <video className="mt-4 w-full rounded-md border border-[var(--line)] bg-black" controls preload="metadata" src={resultVideo.url} /> : <p className="mt-4 rounded-md border border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">正在准备画面…</p>}<p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">暂停到你清晰出现的画面，再选择右侧候选。</p></div>
              <div className="rounded-md border border-[var(--ai)] bg-[var(--content)] p-4"><p className="text-sm font-semibold text-[var(--text-primary)]">哪个是你？</p><div className="mt-4 space-y-2">{candidates.map((candidate) => <button key={candidate.id} type="button" className={`w-full rounded-md border p-3 text-left transition ${selected === candidate.id ? 'border-[var(--ai)] bg-[var(--ai)]/10' : 'border-[var(--line)] hover:border-[var(--ai)]/50'}`} onClick={() => confirmCandidate(candidate.id)}><span className="flex items-center justify-between gap-3"><b className="text-sm text-[var(--text-primary)]">{candidate.title}</b><span className={selected === candidate.id ? 'text-xs text-[var(--ai)]' : 'text-xs text-[var(--text-muted)]'}>{selected === candidate.id ? '已选择' : '选择'}</span></span><span className="mt-1 block text-xs text-[var(--text-muted)]">{candidate.clue}</span></button>)}</div>{selected && <div className="mt-4 border-t border-[var(--line)] pt-4"><p className="text-sm font-medium text-[var(--ai)]">已确认，正在整理你的表现</p></div>}</div>
            </div>}
            {success && detection && <p className="mt-5 text-sm text-[var(--text-muted)]">已整理约 {Math.round(detection.durationSeconds || 0)} 秒比赛画面</p>}
          </section>
        )}
        <div className="mt-5"><Link className="btn-secondary" to="/">返回功能选择</Link></div>
      </div>
    </div>
  )
}
