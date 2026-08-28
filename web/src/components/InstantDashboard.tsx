import type { InstantAnalysisDashboard, InstantEvent, InstantPair, InstantPlayer } from '../lib/instantAnalysis'

function shown(value: number | undefined, suffix = ''): string {
  return value === undefined ? '—' : `${value}${suffix}`
}

function PairCard({ label, pair, suffix = '' }: { label: string; pair?: InstantPair; suffix?: string }) {
  const home = pair?.home
  const away = pair?.away
  const total = Math.max(1, (home ?? 0) + (away ?? 0))
  const width = home === undefined || away === undefined ? 50 : home / total * 100
  return <article className="instant-pair"><span>{label}</span><div><b>{shown(home, suffix)}</b><i>我方</i><b>{shown(away, suffix)}</b></div><div className="metric-track"><i className="home" style={{ width: `${width}%` }} /><i className="away" style={{ width: `${100 - width}%` }} /></div></article>
}

function time(value?: number): string {
  if (value === undefined) return '--:--'
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.round(value % 60)).padStart(2, '0')}`
}

function Events({ events }: { events: InstantEvent[] }) {
  if (!events.length) return <p className="instant-empty">暂无关键事件</p>
  return <div className="instant-events">{events.slice(0, 5).map((item, index) => <span key={`${item.time ?? index}-${item.type ?? index}`}><b>{time(item.time)}</b>{item.label || item.type || item.note || '关键片段'}</span>)}</div>
}

function PlayerCard({ player, rank }: { player: InstantPlayer; rank: number }) {
  return <article className="instant-player"><header><span>{String(rank).padStart(2, '0')}</span><div><h3>{player.number ? `${player.number}号 ${player.name || '球员'}` : player.name || '焦点球员'}</h3><p>{player.title || player.position || player.highlight?.note || player.insights[0] || '本场表现'}</p></div>{player.score !== undefined && <b>{player.score}</b>}</header></article>
}

export default function InstantDashboard({ dashboard }: { dashboard: InstantAnalysisDashboard }) {
  const summary = dashboard.summary
  const players = [...dashboard.players].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5)
  return <section className="instant-dashboard" aria-label="球队分析结果">
    <header className="instant-verdict"><span>一句话总评</span><h2>{summary.overall || summary.highlight || '这段比赛的重点已整理好。'}</h2></header>
    <section className="instant-evidence"><h2>比赛数据</h2><div className="instant-score-grid"><PairCard label="比分" pair={dashboard.score} /><PairCard label="明显射门" pair={dashboard.shots} /></div></section>
    <section className="instant-priority-grid">
      <article className="is-good"><span>最大亮点</span><h3>{summary.highlight || '进攻推进更主动'}</h3></article>
      <article className="is-risk"><span>最大问题</span><h3>{summary.weakness || '丢球后的保护不足'}</h3></article>
    </section>
    <section className="instant-focus-players"><header className="instant-section-head"><h2>焦点球员表现</h2><span>Top {players.length || 0}</span></header>{players.length ? <div className="instant-player-grid">{players.map((player, index) => <PlayerCard key={player.id} player={player} rank={index + 1} />)}</div> : <p className="instant-empty">暂无球员表现</p>}</section>
    <section className="instant-key-events"><header className="instant-section-head"><h2>关键事件</h2><span>最多 5 条</span></header><Events events={dashboard.events} /></section>
    <article className="instant-recommendation"><span>下一阶段建议</span><p>{summary.recommendation || summary.focus || '继续观察下一阶段的场面变化。'}</p></article>
  </section>
}
