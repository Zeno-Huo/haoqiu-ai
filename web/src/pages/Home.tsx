import { Link } from 'react-router-dom'
import { getTeamProfile, listMatches } from '../lib/storage'
import { formatDate } from '../lib/utils'
import type { Match } from '../types'

function RecentMatches({ matches }: { matches: Match[] }) {
  if (!matches.length) return null
  return (
    <section className="mt-14">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="section-title">最近复盘</h2>
        <Link to="/match/new" className="text-sm text-[var(--ai)]">上传新视频 →</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.slice(0, 4).map((match) => (
          <Link key={match.id} to={match.analysis ? `/match/${match.id}` : `/match/${match.id}/analyzing`} className="panel panel-interactive flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate font-medium text-[var(--text-primary)]">{match.name}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDate(match.date)} · {match.type} · {match.players.length} 个候选</p>
            </div>
            <span className="status-text"><span className="status-dot" />{match.analysis ? '已出复盘' : '待分析'}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  const matches = listMatches()
  const team = getTeamProfile()
  const preview = team.members.slice(0, 6)

  return (
    <div className="page-shell">
      <section className="home-hero">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:py-28">
          <div className="max-w-2xl animate-in">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-[var(--text-primary)] sm:text-6xl">上传一段视频，马上复盘这节球。</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--text-secondary)] sm:text-lg">先进入本地演示复盘，查看比分、控球、射门和全队表现；球员信息可由队长后续补充。</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/match/new" className="btn-primary">上传视频，马上复盘 <span aria-hidden>→</span></Link>
              <Link to="/team" className="btn-secondary">管理我的球队</Link>
            </div>
            <p className="mt-3 text-xs text-[var(--text-muted)]">本地演示：浏览器只读取本地文件信息，演示数据与真实分析待接入会持续区分显示。</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <section className="panel mb-10 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <p className="field-label !mb-2">我的球队</p>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">{team.name}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{team.members.length} 名预存成员 · 姓名、昵称、常用号码和位置只用作确认线索</p>
            {preview.length > 0 && (
              <div className="team-preview mt-4">
                {preview.map((member) => <span key={member.id}>{member.nickname || member.name}{member.commonNumber ? ` · ${member.commonNumber}号` : ''}</span>)}
                {team.members.length > preview.length && <span>+{team.members.length - preview.length}</span>}
              </div>
            )}
          </div>
          <Link to="/team" className="btn-secondary mt-5 shrink-0 sm:mt-0">{team.members.length ? '管理成员' : '添加球队成员'}</Link>
        </section>

        <div className="grid gap-px overflow-hidden border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
          {[
            ['选择视频', '本地读取时长、画幅等信息，不会上传文件。'],
            ['画面检查', '查看本地演示可继续或建议重拍的提示。'],
            ['进入复盘 Demo', '查看现有球队看板样例，数据会明确标注为演示。'],
          ].map(([title, description], index) => (
            <div key={title} className="bg-[var(--surface)] p-6">
              <span className="font-score text-sm text-[var(--ai)]">0{index + 1}</span>
              <h2 className="mt-8 text-lg font-medium text-[var(--text-primary)]">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{description}</p>
            </div>
          ))}
        </div>
        <RecentMatches matches={matches} />
      </section>
    </div>
  )
}
