import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { analyzeMatch } from '../lib/engine'
import { getMatch, saveAnalysis } from '../lib/storage'

const TOTAL_MS = 1800 // 本地演示任务，不调用模型或 GPU
const STAGES = ['读取比赛信息', '应用演示数据', '整理球队指标', '生成球员概览', '复盘已准备好']

export default function Analyzing() {
  const { id } = useParams()
  const navigate = useNavigate()
  // useMemo 保证 match 引用稳定，避免 effect 因每次 render 重新解析 localStorage 而反复重跑
  const match = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [progress, setProgress] = useState(0)
  const stage = Math.min(STAGES.length - 1, Math.floor((progress / 100) * STAGES.length))

  useEffect(() => {
    if (!match) {
      navigate('/', { replace: true })
      return
    }
    const start = Date.now()
    const timer = window.setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - start) / TOTAL_MS) * 100))
      setProgress(p)
      if (p >= 100) {
        window.clearInterval(timer)
      }
    }, 60)

    return () => window.clearInterval(timer)
  }, [match, navigate])

  if (!match) return null
  const currentMatch = match
  const complete = progress >= 100

  function openDemo() {
    const analyses = analyzeMatch(currentMatch)
    saveAnalysis(currentMatch.id, analyses)
    navigate(`/match/${currentMatch.id}/identify`, { replace: true })
  }

  return (
    <div className="page-shell mx-auto max-w-xl px-4 py-20">
      <section className="panel px-5 py-8 text-center sm:px-10">
      <p className="eyebrow">本地演示任务</p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{complete ? '球队复盘 Demo 已准备好' : '正在准备球队复盘 Demo'}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        「{match.videoName || match.name}」 · 未上传视频，未调用真实 AI 或 GPU
      </p>
      <div className="mx-auto mt-9 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[var(--surface-raised)]">
        <div
          className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
        <span className="status-dot" />{STAGES[stage]} <b className="font-score ml-1 text-[var(--ai)]">{progress}%</b>
      </div>
      <ol className="mt-9 divide-y divide-[var(--line)] border-y border-[var(--line)] text-left">
        {STAGES.map((label, index) => <li key={label} className={`flex items-center gap-3 py-3 text-sm ${index <= stage ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}><span className={`stage-dot ${index <= stage ? 'is-active' : ''}`} />{label}</li>)}
      </ol>
      {complete && <div className="mt-7"><button className="btn-primary w-full" onClick={openDemo}>进入球队复盘 Demo <span aria-hidden>→</span></button><p className="mt-3 text-xs text-[var(--text-muted)]">看板中的比分、控球、射门及球员数据均为演示数据。</p></div>}
      </section>
    </div>
  )
}
