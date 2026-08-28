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

  if (!initialMatch) return <div className="page-shell grid place-items-center px-4"><Link className="btn-primary" to="/match/new?mode=instant">重新选择视频</Link></div>
  const success = job?.status === 'succeeded'
  const failed = job?.status === 'failed'
  const parsed = job ? parseInstantAnalysis(job) : {}
  const progress = job ? Math.min(100, Math.max(0, job.progress)) : uploadProgress
  const stage = !job ? (phase === 'uploading' ? '正在上传视频' : '正在准备视频') : job.status === 'queued' ? '正在等待分析' : job.status === 'running' ? '正在看这场球' : '正在生成结果'

  return <div className="page-shell px-4 py-8"><div className="mx-auto max-w-3xl">
    <header className="analysis-header"><Link to="/match/new?mode=instant">← 返回</Link><h1>{success ? '分析完成' : failed ? '分析未完成' : '正在看这场球'}</h1><p>{initialMatch.videoName}</p></header>
    {!configured ? <section className="panel p-6"><h2>分析暂时不可用</h2><Link className="btn-primary mt-5" to="/match/new?mode=instant">重新开始</Link></section> : <>
      {!success && !failed && <section className="analysis-progress"><div><i style={{ width: `${progress}%` }} /></div><p><span>{stage}</span><b>{progress}%</b></p></section>}
      {message && <section className="analysis-error"><p>{message}</p><button className="btn-secondary" onClick={() => setRetryNonce((value) => value + 1)}>再试一次</button></section>}
      {failed && <section className="analysis-error"><p>{job?.error?.message || '这次分析没有完成'}</p><Link className="btn-primary" to="/match/new?mode=instant">重新选择视频</Link></section>}
      {success && (parsed.dashboard ? <InstantDashboard dashboard={parsed.dashboard} /> : parsed.narrative ? <Narrative content={parsed.narrative} /> : <section className="panel p-6"><h2>结果正在整理</h2></section>)}
      {success && <div className="analysis-actions"><button className="btn-secondary" type="button" onClick={() => void (navigator.share ? navigator.share({ title: '好球 Ai 比赛分析', text: parsed.narrative || '我的比赛分析已经完成', url: location.href }) : navigator.clipboard.writeText(location.href))}>分享结果</button><Link className="btn-primary" to="/match/new?mode=instant">再分析一段</Link></div>}
    </>}
  </div></div>
}
