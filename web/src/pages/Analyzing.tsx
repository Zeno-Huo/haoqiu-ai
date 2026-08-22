import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { analyzeMatch } from '../lib/engine'
import { getMatch, saveAnalysis } from '../lib/storage'

const TOTAL_MS = 1600 // 快速走完进度条

export default function Analyzing() {
  const { id } = useParams()
  const navigate = useNavigate()
  // useMemo 保证 match 引用稳定，避免 effect 因每次 render 重新解析 localStorage 而反复重跑
  const match = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!match) {
      navigate('/', { replace: true })
      return
    }
    if (match.analysis) {
      navigate(`/match/${match.id}`, { replace: true })
      return
    }

    const start = Date.now()
    const timer = window.setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - start) / TOTAL_MS) * 100))
      setProgress(p)
      if (p >= 100) {
        window.clearInterval(timer)
        const analyses = analyzeMatch(match)
        saveAnalysis(match.id, analyses)
        navigate(`/match/${match.id}`, { replace: true })
      }
    }, 60)

    return () => window.clearInterval(timer)
  }, [match, navigate])

  if (!match) return null

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-xl font-bold text-slate-800">正在生成比赛看板…</h1>
      <p className="mt-2 text-sm text-slate-500">
        「{match.name}」 · 共 {match.players.length} 名球员
      </p>
      <div className="mx-auto mt-8 h-2.5 w-72 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-pitch-600 to-lime-500 transition-all duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-3 text-sm font-semibold tabular-nums text-pitch-700">{progress}%</p>
    </div>
  )
}
