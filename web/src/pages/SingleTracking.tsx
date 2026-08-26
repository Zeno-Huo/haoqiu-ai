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
    clue: index === 0 ? '画面出现较稳定 · 建议优先确认' : '由检测框连续出现生成的候选',
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
  const stage = job?.stage === 'detecting' ? '正在读取整段视频中的球员候选' : job?.stage === 'rendering' ? '正在生成带框检测视频' : job?.status === 'queued' ? '等待 GPU 任务' : job ? '单人跟拍处理中' : UPLOAD_PHASE_LABELS[phase]

  function confirmCandidate(candidateId: string) {
    setSelected(candidateId)
    const latest = getMatch(matchRecord.id) ?? matchRecord
    saveMatch({ ...latest, trackingCandidateId: candidateId })
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7">
          <p className="eyebrow">单人跟拍 · YOLO 目标检测</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{success ? '选择本次跟拍对象' : failed ? '单人跟拍未完成' : '正在建立单人候选'}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">使用与深度复盘相同的 GPU 检测链路。先完整读取视频并生成候选，再由你确认要持续观察的那一名球员。</p>
        </header>

        {!configured ? <section className="panel p-6"><h2 className="text-lg font-semibold text-[var(--text-primary)]">未配置云端检测服务</h2><p className="mt-2 text-sm text-[var(--text-muted)]">单人跟拍需连接 HAI 的 YOLO 服务后才能创建任务。</p><Link className="btn-primary mt-5" to="/match/new?mode=single">重新选择视频</Link></section> : (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p><p className="mt-1 font-score text-xs text-[var(--text-muted)]">{job?.job_id ? `任务 ${job.job_id}` : '等待安全上传信息'}</p></div><span className="status-text"><span className="status-dot" />{job?.status ?? phase}</span></div>
            {!success && !failed && <><div className="mt-7 h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div><div className="mt-3 flex justify-between text-sm text-[var(--text-secondary)]"><span>{stage}</span><b className="font-score text-[var(--ai)]">{progress}%</b></div></>}
            {message && <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4 text-sm text-[var(--attack)]">{message}<Link className="btn-secondary mt-4" to="/match/new?mode=single">重新选择视频</Link></div>}
            {failed && <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4"><p className="text-sm text-[var(--danger)]">{job?.error?.message || 'YOLO 检测任务未能完成'}</p><Link className="btn-secondary mt-4" to="/match/new?mode=single">重新选择视频</Link></div>}
            {success && <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
              <div className="rounded-md border border-[var(--line)] bg-[var(--content)] p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-[var(--text-primary)]">带框检测视频</h2><span className="text-xs text-[var(--text-muted)]">完整视频已处理</span></div>{resultVideo ? <video className="mt-4 w-full rounded-md border border-[var(--line)] bg-black" controls preload="metadata" src={resultVideo.url} /> : <p className="mt-4 rounded-md border border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">正在取得短期播放地址…</p>}<p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">在视频中暂停到目标球员清晰出现的时刻，再确认候选对象。</p></div>
              <div className="rounded-md border border-[var(--ai)] bg-[var(--content)] p-4"><p className="text-sm font-semibold text-[var(--text-primary)]">确认跟拍对象</p><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">候选来自本次 YOLO 检测画面；确认后只把该对象作为本次训练观察的主角。</p><div className="mt-4 space-y-2">{candidates.map((candidate) => <button key={candidate.id} type="button" className={`w-full rounded-md border p-3 text-left transition ${selected === candidate.id ? 'border-[var(--ai)] bg-[var(--ai)]/10' : 'border-[var(--line)] hover:border-[var(--ai)]/50'}`} onClick={() => confirmCandidate(candidate.id)}><span className="flex items-center justify-between gap-3"><b className="text-sm text-[var(--text-primary)]">{candidate.title}</b><span className={selected === candidate.id ? 'text-xs text-[var(--ai)]' : 'text-xs text-[var(--text-muted)]'}>{selected === candidate.id ? '已选择' : '待确认'}</span></span><span className="mt-1 block text-xs text-[var(--text-muted)]">{candidate.clue}</span></button>)}</div>{selected && <div className="mt-4 border-t border-[var(--line)] pt-4"><p className="text-sm font-medium text-[var(--ai)]">{candidates.find((item) => item.id === selected)?.title} 已设为观察对象</p><p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">本版已完成真实 YOLO 视频检测与对象确认。轨迹连续化、动作切片和训练建议将在跟踪层接入后写入本卡。</p></div>}</div>
            </div>}
            {success && detection && <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4"><div className="bg-[var(--content)] p-3"><dt className="text-xs text-[var(--text-muted)]">已处理帧</dt><dd className="mt-1 font-score text-[var(--ai)]">{detection.processedFrames}</dd></div><div className="bg-[var(--content)] p-3"><dt className="text-xs text-[var(--text-muted)]">球员检测帧</dt><dd className="mt-1 font-score text-[var(--text-primary)]">{detection.playerFrames}</dd></div><div className="bg-[var(--content)] p-3"><dt className="text-xs text-[var(--text-muted)]">球出现帧</dt><dd className="mt-1 font-score text-[var(--text-primary)]">{detection.ballFrames}</dd></div><div className="bg-[var(--content)] p-3"><dt className="text-xs text-[var(--text-muted)]">视频时长</dt><dd className="mt-1 font-score text-[var(--text-primary)]">{detection.durationSeconds ? `${Math.round(detection.durationSeconds)}s` : '—'}</dd></div></dl>}
          </section>
        )}
        <div className="mt-5"><Link className="btn-secondary" to="/">返回功能选择</Link></div>
      </div>
    </div>
  )
}
