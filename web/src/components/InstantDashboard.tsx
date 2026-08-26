import type { InstantAnalysisDashboard, InstantEvent, InstantPair, InstantPlayer, InstantTeamStats } from '../lib/instantAnalysis'

function value(value: number | undefined, suffix = ''): string {
  return value === undefined ? '—' : `${value}${suffix}`
}

function PairCard({ label, pair, suffix = '' }: { label: string; pair?: InstantPair; suffix?: string }) {
  const home = pair?.home
  const away = pair?.away
  const total = Math.max(1, (home ?? 0) + (away ?? 0))
  const width = home === undefined || away === undefined ? 50 : home / total * 100
  return <article className="panel p-4"><div className="flex items-center justify-between text-sm font-semibold"><span>{label}</span><span className="text-xs font-normal text-[var(--text-muted)]">我方 / 对手</span></div><div className="mt-3 flex justify-between font-score text-2xl"><b className="text-[var(--ai)]">{value(home, suffix)}</b><b className="text-[var(--opponent)]">{value(away, suffix)}</b></div><div className="metric-track mt-3" aria-label={`${label}双方对比`}><i className="home" style={{ width: `${width}%` }} /><i className="away" style={{ width: `${100 - width}%` }} /></div></article>
}

const STAT_LABELS: Array<[keyof InstantTeamStats, string]> = [
  ['touches', '总拿球'], ['passes', '总传球'], ['passesSuccess', '传球成功'], ['passErrors', '传球失误'],
  ['shots', '总射门'], ['shotsOnTarget', '射正'], ['goals', '进球'], ['assists', '助攻'], ['turnovers', '其他失误'], ['dispossessed', '被断球'], ['interceptions', '拦截'], ['tackles', '抢断'],
]

function StatList({ stats }: { stats: InstantTeamStats }) {
  return <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-5">{STAT_LABELS.map(([key, label]) => <div className="bg-[var(--surface)] p-3" key={key}><b className="block font-score text-lg text-[var(--ai)]">{value(stats[key])}</b><span className="mt-1 block text-xs text-[var(--text-muted)]">{label}</span></div>)}</div>
}

function time(value?: number): string {
  if (value === undefined) return '--:--'
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.round(value % 60)).padStart(2, '0')}`
}

function EventList({ events, title = '事件时间线' }: { events: InstantEvent[]; title?: string }) {
  if (!events.length) return <p className="mt-3 text-sm text-[var(--text-muted)]">暂无可展示的事件时间点。</p>
  return <><h3 className="mt-4 text-sm font-semibold text-[var(--text-primary)]">{title}</h3><div className="event-list">{events.map((item, index) => <span className="event success" key={`${item.time ?? index}-${item.type ?? item.label ?? index}`}>{time(item.time)} · {item.label || item.type || item.note || '事件'}</span>)}</div></>
}

function PlayerCard({ player }: { player: InstantPlayer }) {
  const s = player.stats
  const statItems: Array<[keyof InstantTeamStats, string]> = [['touches', '拿球'], ['passes', '传球'], ['passErrors', '传球失误'], ['dispossessed', '被断球'], ['shots', '射门'], ['shotsOnTarget', '射正'], ['goals', '进球'], ['assists', '助攻'], ['interceptions', '拦截'], ['tackles', '抢断']]
  const highlight = player.highlight
  const hasHighlight = Boolean(highlight && (highlight.label || highlight.value !== undefined || highlight.note))
  return <article className="panel p-4"><header className="flex items-start justify-between gap-3 border-b border-[var(--line)] pb-3"><div><h3 className="text-base font-semibold text-[var(--text-primary)]"><span className="mr-2 font-score text-[var(--text-muted)]">{player.number || '?'}</span>{player.name || '候选球员'}</h3><div className="mt-2 flex flex-wrap gap-2">{player.position && <span className="inline-block rounded border border-[var(--line)] px-2 py-1 text-xs text-[var(--text-secondary)]">{player.position}</span>}{player.title && <span className="inline-block rounded border border-[var(--ai)]/50 bg-[var(--ai)]/10 px-2 py-1 text-xs text-[var(--ai)]">{player.title}</span>}</div></div><div className="text-right"><b className="font-score text-2xl text-[var(--ai)]">{value(player.score)}</b><span className="block text-[10px] text-[var(--text-muted)]">综合评分 / 10</span></div></header><div className="data-list">{statItems.map(([key, label]) => <span key={key}>{label} <b>{value(s[key])}</b></span>)}</div>{hasHighlight && <div className="mt-3 rounded border border-[var(--ai)]/30 bg-[var(--ai)]/5 p-3 text-sm text-[var(--text-secondary)]"><span className="text-xs text-[var(--ai)]">本场亮点</span><p className="mt-1 font-medium text-[var(--text-primary)]">{highlight?.label || '亮点'}{highlight?.value !== undefined && <b className="ml-2 font-score text-[var(--ai)]">{highlight.value}</b>}</p>{highlight?.note && <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{highlight.note}</p>}</div>}{player.insights.slice(0, 3).map((item) => <p className="insight" key={item}>{item}</p>)}<EventList events={player.events} title="关联片段" /></article>
}

export default function InstantDashboard({ dashboard }: { dashboard: InstantAnalysisDashboard }) {
  const summary = dashboard.summary
  return <section className="mt-6 space-y-5" aria-label="即时分析结构化看板"><div className="rounded-md border border-[var(--ai)]/40 bg-[var(--content)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold text-[var(--text-primary)]">球队即时复盘</h2><span className="status-text"><span className="status-dot" />VLM 实操数据</span></div><p className="mt-1 text-xs text-[var(--text-muted)]">以下字段来自视觉模型返回的结构化分析，不读取演示模式数据。</p></div><div className="grid gap-3 sm:grid-cols-2"><PairCard label="比分" pair={dashboard.score} /><PairCard label="控球率" pair={dashboard.possession} suffix="%" /><PairCard label="射门" pair={dashboard.shots} /></div>{dashboard.teamAverage !== undefined && <div className="panel flex items-center justify-between p-4"><span className="text-sm text-[var(--text-secondary)]">球队平均分</span><b className="font-score text-3xl text-[var(--ai)]">{value(dashboard.teamAverage)}</b></div>}<section><h2 className="section-title">球队观察</h2><div className="summary-grid"><article className="summary-item highlight"><h3>最大亮点</h3><p>{summary.highlight || '暂无模型观察'}</p></article><article className="summary-item weakness"><h3>最大不足</h3><p>{summary.weakness || '暂无模型观察'}</p></article><article className="summary-item focus"><h3>下一轮关注</h3><p>{summary.focus || '暂无模型观察'}</p></article></div></section><section><h2 className="section-title">全队数据</h2><StatList stats={dashboard.teamStats} /></section><section><h2 className="section-title">关键事件</h2><EventList events={dashboard.events} /></section><section><h2 className="section-title">球员表现</h2>{dashboard.players.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{dashboard.players.map((player) => <PlayerCard key={player.id} player={player} />)}</div> : <p className="mt-3 text-sm text-[var(--text-muted)]">暂无球员卡数据。</p>}</section></section>
}
