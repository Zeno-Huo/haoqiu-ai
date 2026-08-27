import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { analyzeMatch } from '../lib/engine'
import { getMatch, saveAnalysis } from '../lib/storage'

const TOTAL_MS = 1800
const STATES = ['正在上传', '正在分析', '复盘准备好了']
const STATE_HINTS = ['把这场比赛安全送进复盘流程。', '正在整理比分、控球、射门和球队亮点。', '']

export default function Analyzing() {
  const { id } = useParams(); const navigate = useNavigate(); const match = useMemo(() => id ? getMatch(id) : undefined, [id]); const [progress, setProgress] = useState(0)
  useEffect(() => { if (!match) { navigate('/', { replace: true }); return }; const start = Date.now(); const timer = window.setInterval(() => { const value = Math.min(100, Math.round((Date.now() - start) / TOTAL_MS * 100)); setProgress(value); if (value >= 100) window.clearInterval(timer) }, 60); return () => window.clearInterval(timer) }, [match, navigate])
  if (!match) return null
  const currentMatch = match
  const state = progress >= 100 ? 2 : progress > 32 ? 1 : 0
  function openReport() { saveAnalysis(currentMatch.id, analyzeMatch(currentMatch)); navigate(`/match/${currentMatch.id}`, { replace: true }) }
  return <div className="page-shell mx-auto max-w-xl px-4 py-20"><section className="panel px-5 py-10 text-center sm:px-10"><p className="eyebrow">本地演示</p><h1 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{STATES[state]}</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">{STATE_HINTS[state] || '比分、控球、射门和球员数据均为演示数据，真实分析待接入。'}</p>{state < 2 && <div className="mx-auto mt-8 h-1.5 max-w-sm overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-200" style={{ width: `${progress}%` }} /></div>}{state === 2 && <button className="btn-primary mt-8 w-full" onClick={openReport}>查看球队复盘 <span aria-hidden>→</span></button>}</section></div>
}
