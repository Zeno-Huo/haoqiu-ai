import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getAnalysisMode, setAnalysisMode, subscribeAnalysisMode, type AnalysisMode } from '../lib/analysisMode'

function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-md border border-[var(--ai)]/50 bg-[var(--ai)]/10">
        <svg viewBox="0 0 32 32" className="h-5 w-5">
          <path d="M16 5 L19.2 11.5 L26 12 L21 17 L23 24 L16 19.8 L9 24 L11 17 L6 12 L12.8 11.5 Z" fill="#fff" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
        好球<span className="text-[var(--ai)]">Ai</span>
      </span>
    </span>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AnalysisMode>(() => getAnalysisMode())

  useEffect(() => subscribeAnalysisMode(setMode), [])

  function switchMode(next: AnalysisMode) {
    setAnalysisMode(next)
    const match = location.pathname.match(/^\/match\/([^/]+)(?:\/(instant|analyzing|detection))?$/)
    if (!match) return
    const currentRoute = match[2] || (next === 'demo' ? 'analyzing' : 'report')
    if (currentRoute === 'detection' && next === 'practical') return
    if (currentRoute === (next === 'demo' ? 'analyzing' : 'instant')) return
    if (next === 'demo') navigate(`/match/${match[1]}/analyzing`)
    else navigate(`/match/${match[1]}/instant`)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/92 backdrop-blur"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" aria-label="好球Ai 首页">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <div className="mode-switch" aria-label="分析模式">
              <button type="button" className={mode === 'practical' ? 'is-active' : ''} onClick={() => switchMode('practical')}>实操模式</button>
              <button type="button" className={mode === 'demo' ? 'is-active' : ''} onClick={() => switchMode('demo')}>演示模式</button>
            </div>
            <Link
              to="/team"
              className="rounded-md px-3 py-2 font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              我的球队
            </Link>
            <Link
              to="/match/new"
              className="rounded-md px-3 py-2 font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              上传视频
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--line)] bg-[var(--bg)] py-6">
        <div className="mx-auto max-w-5xl px-4 text-center text-xs text-[var(--text-muted)]">
          <p className="mb-1 font-medium text-[var(--text-secondary)]">好球Ai · 球队即时复盘</p>
          <p>本地模拟分析，仅用于产品流程演示。</p>
        </div>
      </footer>
    </div>
  )
}
