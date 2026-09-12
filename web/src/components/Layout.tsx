import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <img src="/haoqiu-logo.png" alt="" className="layout-logo" />
      <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
        好球<span className="text-[var(--ai)]">Ai</span>
      </span>
    </span>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isReport = pathname === "/design-preview" || pathname === "/match/new" || /^\/match\/[^/]+\/(instant|tracking|training)$/.test(pathname)
  return (
    <div className="flex min-h-screen flex-col">
      {!isReport && <header className="relative z-30 bg-transparent">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" aria-label="好球Ai 首页">
            <Logo />
          </Link>
          <span aria-hidden="true" className="layout-header-spacer" />
        </div>
      </header>}

      <main className="flex-1">{children}</main>

    </div>
  )
}
