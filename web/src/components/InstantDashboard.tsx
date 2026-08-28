import type { InstantAnalysisDashboard, InstantEvent, InstantPair, InstantPlayer, InstantTeamStats } from '../lib/instantAnalysis'

function shown(value: number | undefined, suffix = ''): string {
  return value === undefined ? '—' : `约 ${value}${suffix}`
}

function PairCard({ label, pair, suffix = '' }: { label: string; pair?: InstantPair; suffix?: string }) {
  const home = pair?.home
  const away = pair?.away
  const total = Math.max(1, (home ?? 0) + (away ?? 0))
  const width = home === undefined || away === undefined ? 50 : home / total * 100
  return <article className="instant-pair"><span>{label}</span><div><b>{shown(home, suffix)}</b><i>我方</i><b>{shown(away, suffix)}</b></div><div className="metric-track"><i className="home" style={{ width: `${width}%` }} /><i className="away" style={{ width: `${100 - width}%` }} /></div></article>
}

const STAT_LABELS: Array<[keyof InstantTeamStats, string]> = [
  ['touches', '拿球'], ['passes', '传球'], ['passesSuccess', '成功传球'], ['passErrors', '传球失误'],
  ['shots', '射门'], ['shotsOnTarget', '射正'], ['goals', '进球'], ['turnovers', '失误'],
  ['dispossessed', '被断'], ['interceptions', '拦截'], ['tackles', '抢断'],
]

function time(value?: number): string {
  if (value === undefined) return '--:--'
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.round(value % 60)).padStart(2, '0')}`
}

function Events({ events }: { events: InstantEvent[] }) {
  if (!events.length) return null
  return <div className="instant-events">{events.map((item, index) => <span key={`${item.time ?? index}-${item.type ?? index}`}><b>{time(item.time)}</b>{item.label || item.type || item.note || '关键片段'}</span>)}</div>
}

function PlayerCard({ player }: { player: InstantPlayer }) {
  const stats = STAT_LABELS.filter(([key]) => player.stats[key] !== undefined).slice(0, 5)
  return <article className="instant-player"><header><span>{player.number || '?'}</span><div><h3>{player.name || '焦点球员'}</h3><p>{player.title || player.position || '本场焦点'}</p></div>{player.score !== undefined && <b>{player.score}</b>}</header>{player.highlight?.note && <p>{player.highlight.note}</p>}{player.insights[0] && <p>{player.insights[0]}</p>}{stats.length > 0 && <div>{stats.map(([key, label]) => <span key={key}>{label}<b>{player.stats[key]}</b></span>)}</div>}<Events events={player.events} /></article>
}

export default function InstantDashboard({ dashboard }: { dashboard: InstantAnalysisDashboard }) {
  const summary = dashboard.summary
  const focusPlayer = dashboard.players[0]
  const headline = summary.highlight || '这段比赛，你们踢得很有冲劲。'
  return <section className="instant-dashboard" aria-label="球队分析结果">
    <header className="instant-verdict"><span>本段总评</span><h2>{headline}</h2><p>{summary.focus || '继续保持优势，同时留意暴露最明显的问题。'}</p></header>
    <div className="instant-priority-grid">
      <article className="is-good"><span>最大亮点</span><h3>{summary.highlight || '进攻推进更主动'}</h3></article>
      <article className="is-risk"><span>最大问题</span><h3>{summary.weakness || '丢球后的保护不足'}</h3></article>
      <article className="is-focus"><span>本段焦点</span><h3>{focusPlayer ? `${focusPlayer.number || ''}号 ${focusPlayer.title || focusPlayer.name || '焦点球员'}` : '等待焦点球员'}</h3></article>
    </div>
    <section className="instant-evidence"><h2>场面概览</h2><div className="instant-pairs"><PairCard label="比分" pair={dashboard.score} /><PairCard label="控球" pair={dashboard.possession} suffix="%" /><PairCard label="射门" pair={dashboard.shots} /></div></section>
    <details className="instant-details"><summary>更多比赛数据</summary><div className="instant-stat-list">{STAT_LABELS.map(([key, label]) => dashboard.teamStats[key] !== undefined && <span key={key}><b>{dashboard.teamStats[key]}</b>{label}</span>)}</div><Events events={dashboard.events} /></details>
    {dashboard.players.length > 0 && <details className="instant-details"><summary>球员表现</summary><div className="instant-player-grid">{dashboard.players.map((player) => <PlayerCard key={player.id} player={player} />)}</div></details>}
  </section>
}
