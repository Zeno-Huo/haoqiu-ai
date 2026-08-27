import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-md border border-[var(--ai)]/50 bg-[var(--ai)]/10">
        <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="17" r="4.5" fill="currentColor" stroke="none" />
          <path d="M4 24c5-10 11-13 24-13M17 7c5 2 7 5 8 10M21 5v5h5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
        好球<span className="text-[var(--ai)]">Ai</span>
      </span>
    </span>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative z-30 bg-transparent">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" aria-label="好球Ai 首页">
            <Logo />
          </Link>
          <span aria-hidden="true" className="layout-header-spacer" />
        </div>
      </header>

      <main className="flex-1">{children}</main>

    </div>
  )
}
