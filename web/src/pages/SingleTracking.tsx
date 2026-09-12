import AnalysisLoading from '../components/AnalysisLoading'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CloudDetectionJob } from '../cloudDetectionTypes'
import { createInstantAnalysisJob, getInstantAnalysisJob, isCloudDetectionConfigured } from '../lib/cloudDetectionApi'
import type { InstantTeamContext } from '../lib/cloudDetectionApi'
import { ensureUploadedVideo, type UploadPhase } from '../lib/cloudUploadWorkflow'
import { getMatch, saveMatch } from '../lib/storage'
import { getCachedVideoFile } from '../lib/videoFileCache'
import { parseInstantAnalysis } from '../lib/instantAnalysis'
import InstantDashboard from '../components/InstantDashboard'

async function createWorkflow(
  matchId: string,
  file: File | undefined,
  listener: (phase: UploadPhase, progress: number) => void,
  context?: InstantTeamContext,
) {
  const match = getMatch(matchId)
  if (!match) throw new Error('找不到这段视频')
  const uploadId = await ensureUploadedVideo(matchId, file, listener)
  const job = await createInstantAnalysisJob(uploadId, matchId, context)
  saveMatch({ ...match, cloudUploadId: uploadId, instantJobId: job.job_id, instantAnalysisJob: job })
  return job
}

function Narrative({ content }: { content: string }) {
  return (
    <article className="instant-narrative">
      <span>个人表现复盘</span>
      {content.split(/\n{2,}/).filter(Boolean).map((block, index) => <p key={index}>{block.replace(/^[-·•*]\s*/, '')}</p>)}
    </article>
  )
}

export default function SingleTracking() {
  const { id } = useParams()
  const initialMatch = useMemo(() => (id ? getMatch(id) : undefined), [id])
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
    const ctx = match.ourTeamContext
    const focusHint = ctx?.jerseyHint?.trim()
    const jobContext: InstantTeamContext = {
      analysis_mode: 'personal_match',
      ...(focusHint ? { jersey_hint: focusHint, team_name: ctx?.teamName } : ctx?.teamName ? { team_name: ctx.teamName } : {}),
    }
    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.instantJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) throw new Error('视频已失效，请重新选择')
          const created = await createWorkflow(match.id, file, (next, progress) => {
            if (!cancelled) { setPhase(next); setUploadProgress(progress) }
          }, jobContext)
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

  if (!initialMatch) {
    return (
      <div className="page-shell grid place-items-center px-4">
        <section className="panel max-w-md p-6 text-center">
          <p className="text-[var(--text-secondary)]">这段视频只保留在当前页面，刷新或重新打开后需要再次上传。</p>
          <Link className="btn-primary mt-5" to="/match/new?mode=single">重新上传视频</Link>
        </section>
      </div>
    )
  }

  const success = job?.status === 'succeeded'
  const failed = job?.status === 'failed'
  const parsed = job ? parseInstantAnalysis(job) : {}
  const focusHint = initialMatch.ourTeamContext?.jerseyHint?.trim()
  const progress = job ? Math.min(100, Math.max(0, job.progress)) : uploadProgress
  const stage = failed ? '分析未完成' : !job
    ? (phase === 'uploading' ? '正在上传视频' : '正在准备视频')
    : job.status === 'queued' ? '正在等待分析' : '正在生成结果'

  if (success && parsed.dashboard) return <InstantDashboard dashboard={parsed.dashboard} matchId={initialMatch.id} mode="personal" focusHint={focusHint} />

  if (!success) return <AnalysisLoading filename={initialMatch.videoName || '比赛视频'} progress={progress} stage={!job ? stage : job.status === 'queued' ? '正在等待分析' : '正在梳理比赛表现'} uploading={!job} error={!configured?'分析服务暂时不可用':failed?job?.error?.message || '这次分析没有完成':message || undefined} onRetry={message?()=>setRetryNonce(n=>n+1):undefined}/>

  return <main className="vr-page"><header className="vr-nav"><Link to="/">返回</Link><h1>比赛复盘</h1><span/></header>{parsed.narrative?<Narrative content={parsed.narrative}/>:<p className="vr-empty">本次报告暂时无法展示</p>}<Link className="vr-primary" to="/match/new?mode=single">重新选择视频</Link></main>
}
