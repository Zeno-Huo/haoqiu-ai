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
        <div className="mx-auto max-w-5xl px-4 py-10 sm:py-12">
          <div className="max-w-2xl animate-in">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl">上传视频，马上分析</h1>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10">
        <section className="mb-12">
          <div className="grid gap-4 lg:grid-cols-3">
            <article className="panel border-[var(--ai)] p-6">
              <span className="font-score text-2xl font-bold text-[var(--ai)]">01</span>
              <h3 className="mt-2 text-xl font-semibold text-[var(--ai)]">即时分析</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">快速统计比赛数据，辅助教练在比赛中决策。</p>
              <Link to="/match/new?mode=instant" className="btn-primary mt-5 w-full justify-center">开始即时分析 <span aria-hidden>→</span></Link>
            </article>
            <article className="panel border-[var(--ai)] p-6">
              <span className="font-score text-2xl font-bold text-[var(--ai)]">02</span>
              <h3 className="mt-2 text-xl font-semibold text-[var(--ai)]">深度复盘</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">分析时间较长，仅适用赛后复盘以及球员成长。</p>
              <Link to="/match/new?mode=deep" className="btn-secondary mt-5 w-full justify-center">开始深度复盘 <span aria-hidden>→</span></Link>
            </article>
            <article className="panel border-[var(--ai)] p-6">
              <span className="font-score text-2xl font-bold text-[var(--ai)]">03</span>
              <h3 className="mt-2 text-xl font-semibold text-[var(--ai)]">单人跟拍</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">从一段训练或比赛视频中选择一名球员，沉淀其动作片段与观察记录。</p>
              <Link to="/match/new?mode=single" className="btn-secondary mt-5 w-full justify-center">开始单人跟拍 <span aria-hidden>→</span></Link>
            </article>
          </div>
        </section>

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
