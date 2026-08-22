import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-pitch-600 shadow-sm">
        <svg viewBox="0 0 32 32" className="h-5 w-5">
          <path d="M16 5 L19.2 11.5 L26 12 L21 17 L23 24 L16 19.8 L9 24 L11 17 L6 12 L12.8 11.5 Z" fill="#fff" />
        </svg>
      </span>
      <span className={`text-lg font-bold tracking-tight ${dark ? 'text-white' : 'text-slate-800'}`}>
        好球<span className="text-pitch-600">Ai</span>
      </span>
    </span>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isHome = pathname === '/'

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className={`sticky top-0 z-30 backdrop-blur ${
          isHome ? 'bg-pitch-900/90 text-white' : 'bg-white/85 text-slate-800'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" aria-label="好球Ai 首页">
            <Logo dark={isHome} />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/match/new"
              className={`rounded-lg px-3 py-2 font-medium transition ${
                isHome
                  ? 'text-white hover:bg-white/10'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              创建比赛
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-white/60 py-6">
        <div className="mx-auto max-w-5xl px-4 text-center text-xs text-slate-400">
          <p className="mb-1 font-medium text-slate-500">好球Ai · AI 足球客观数据分析</p>
          <p>一台手机、一场比赛，全队表现一屏看懂。</p>
        </div>
      </footer>
    </div>
  )
}
