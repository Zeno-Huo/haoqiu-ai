import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CloudDetectionJob } from '../cloudDetectionTypes'
import { createInstantAnalysisJob, getInstantAnalysisJob, isCloudDetectionConfigured } from '../lib/cloudDetectionApi'
import { ensureUploadedVideo, type UploadPhase } from '../lib/cloudUploadWorkflow'
import { getMatch, saveMatch } from '../lib/storage'
import { getCachedVideoFile } from '../lib/videoFileCache'
import { parseInstantAnalysis } from '../lib/instantAnalysis'
import InstantDashboard from '../components/InstantDashboard'

async function createWorkflow(matchId: string, file: File | undefined, listener: (phase: UploadPhase, progress: number) => void) {
  const match = getMatch(matchId)
  if (!match) throw new Error('找不到这段视频')
  const uploadId = await ensureUploadedVideo(matchId, file, listener)
  const context = match.ourTeamContext
  const job = await createInstantAnalysisJob(uploadId, matchId, context ? { team_name: context.teamName, jersey_hint: context.jerseyHint, opening_frame_point: context.openingFramePoint } : undefined)
  saveMatch({ ...match, cloudUploadId: uploadId, instantJobId: job.job_id, instantAnalysisJob: job })
  return job
}

function Narrative({ content }: { content: string }) {
  return <article className="instant-narrative"><span>比赛结论</span>{content.split(/\n{2,}/).filter(Boolean).map((block, index) => <p key={index}>{block.replace(/^[-·•*]\s*/, '')}</p>)}</article>
}

export default function InstantAnalysis() {
  const { id } = useParams()
  const initialMatch = useMemo(() => id ? getMatch(id) : undefined, [id])
  const [job, setJob] = useState<CloudDetectionJob | undefined>(initialMatch?.instantAnalysisJob)
  const [phase, setPhase] = useState<UploadPhase>('ticket')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const configured = isCloudDetectionConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    let cancelled = false
    let timer: number | undefined
    const match = initialMatch
    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.instantJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) throw new Error('视频已失效，请重新选择')
          const created = await createWorkflow(match.id, file, (next, progress) => { if (!cancelled) { setPhase(next); setUploadProgress(progress) } })
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
        }
        async function poll() {
          if (!jobId || cancelled) return
          try {
            const current = await getInstantAnalysisJob(jobId)
            if (cancelled) return
            setJob(current); setMessage('')
            const saved = getMatch(match.id) ?? match
            saveMatch({ ...saved, instantJobId: current.job_id, instantAnalysisJob: current })
            if (current.status !== 'succeeded' && current.status !== 'failed') timer = window.setTimeout(poll, 3000)
          } catch { if (!cancelled) setMessage('暂时无法获取进度') }
        }
        await poll()
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : '分析没有完成') }
    }
    void run()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [configured, initialMatch, retryNonce])

  if (!initialMatch) return <div className="page-shell grid place-items-center px-4"><Link className="btn-primary" to="/">返回首页</Link></div>
  const success = job?.status === 'succeeded'
  const failed = job?.status === 'failed'
  const parsed = job ? parseInstantAnalysis(job) : {}
  const progress = job ? Math.min(100, Math.max(0, job.progress)) : uploadProgress
  const stage = !job ? (phase === 'uploading' ? '正在上传视频' : '正在准备视频') : job.status === 'queued' ? '正在等待分析' : '正在生成结果'
  const isUploading = !job
  const isAnalyzing = !!job && !success && !failed

  const steps = [
    { key: 'upload', label: '上传视频', done: !isUploading, active: isUploading },
    { key: 'analyze', label: 'AI 分析', done: success, active: isAnalyzing },
    { key: 'report', label: '查看报告', done: success, active: success },
  ]

  return <div className="page-shell px-4 py-10"><div className="mx-auto max-w-3xl">
    <header className="mb-8">
      <p className="eyebrow">比赛分析</p>
      <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{success ? '球队复盘报告' : failed ? '分析未完成' : '正在看这场球'}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{success ? 'AI 已完成分析，以下是这场球的球队复盘' : failed ? '这次分析没有完成，可以重新试一次' : '请稍等，AI 正在为这场球生成复盘报告'}</p>
    </header>

    {!success && !failed && (
      <div className="mb-8 flex items-center justify-between gap-2">
        {steps.map((step, idx) => (
          <div key={step.key} className="flex flex-1 items-center gap-2">
            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${
              step.done ? 'bg-[var(--ai)] text-white' : step.active ? 'bg-[var(--ai)]/15 text-[var(--ai)] ring-2 ring-[var(--ai)]/30' : 'bg-[var(--surface-raised)] text-[var(--text-muted)]'
            }`}>
              {step.done ? '✓' : idx + 1}
            </div>
            <span className={`text-sm font-medium transition ${step.active ? 'text-[var(--text-primary)]' : step.done ? 'text-[var(--ai)]' : 'text-[var(--text-muted)]'}`}>{step.label}</span>
            {idx < steps.length - 1 && <div className={`mx-2 h-px flex-1 ${step.done ? 'bg-[var(--ai)]' : 'bg-[var(--line)'}`} />}
          </div>
        ))}
      </div>
    )}

    {!configured ? <section className="panel p-6"><h2>分析暂时不可用</h2><Link className="btn-primary mt-5" to="/match/new?mode=instant">重新开始</Link></section> : <>
      {!success && !failed && <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p></div>
          <span className="status-text"><span className="status-dot" />{isUploading ? '上传中' : '分析中'}</span>
        </div>
        <div className="mt-7 h-2.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
          <div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 flex justify-between text-sm text-[var(--text-secondary)]">
          <span>{stage}</span>
          <b className="font-score text-[var(--ai)]">{Math.round(progress)}%</b>
        </div>
        {isUploading && <p className="mt-3 text-xs text-[var(--text-muted)]">视频上传完成后，AI 将自动开始分析</p>}
        {isAnalyzing && <p className="mt-3 text-xs text-[var(--text-muted)]">AI 正在分析，完成后会自动展示球队报告</p>}
      </section>}
      {message && <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4 text-sm text-[var(--attack)]">{message}<div className="mt-4"><button className="btn-secondary" type="button" onClick={() => setRetryNonce((value) => value + 1)}>再试一次</button></div></div>}
      {failed && <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4"><p className="text-sm text-[var(--danger)]">{job?.error?.message || '这次分析没有完成'}</p><div className="mt-4"><Link className="btn-secondary" to="/match/new?mode=instant">重新选择视频</Link></div></div>}
      {success && (parsed.dashboard ? <InstantDashboard dashboard={parsed.dashboard} matchId={initialMatch.id} /> : parsed.narrative ? <Narrative content={parsed.narrative} /> : <section className="panel p-6"><h2>结果正在整理</h2></section>)}
      {success && <div className="analysis-actions"><button className="btn-secondary" type="button" onClick={() => void (navigator.share ? navigator.share({ title: '好球 Ai 比赛战报', text: parsed.narrative || '我的比赛战报已经完成', url: location.href }) : navigator.clipboard.writeText(location.href))}>分享战报</button><Link className="btn-primary" to="/match/new?mode=instant">再分析一段</Link></div>}
    </>}
  </div></div>
}
