import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { buildMatchSummary } from '../lib/engine'
import { deleteMatch, getMatch } from '../lib/storage'
import { formatDate, formatDuration } from '../lib/utils'
import type { Match, MatchSummary, Player, PlayerAnalysis, PlayerStats } from '../types'

function Comparison({ label, home, away, suffix = '' }: { label: string; home: number; away: number; suffix?: string }) {
  const total = Math.max(1, home + away)
  const homeWidth = (home / total) * 100
  return <section className="panel comparison"><div className="comparison-heading"><span>{label}</span><span className="comparison-label">双方对比</span></div><div className="dual-numbers"><span className="home">{home}{suffix}</span><span className="away">{away}{suffix}</span></div><div className="metric-track" aria-label={`${label}：我方 ${home}${suffix}，对方 ${away}${suffix}`}><i className="home" style={{ width: `${homeWidth}%` }} /><i className="away" style={{ width: `${100 - homeWidth}%` }} /></div><div className="metric-ticks" aria-hidden /></section>
}

function Summary({ summary }: { summary: MatchSummary }) {
  const weakness = summary.points[0] ?? '继续减少失误，让每次处理球更从容'
  const focus = summary.points[1] ?? (summary.outcome === 'loss' ? '下一轮重点关注传球、射门与失误的变化' : '下一轮继续观察传球、射门与防守数据的稳定性')
  return <section className="summary-grid" aria-label="球队总结"><article className="summary-item highlight"><h2>最大亮点 · 演示数据</h2><p>{summary.headline}</p></article><article className="summary-item weakness"><h2>最大不足 · 演示数据</h2><p>{weakness}</p></article><article className="summary-item focus"><h2>下一轮关注 · 演示数据</h2><p>{focus}</p></article></section>
}

function TeamStats({ analyses }: { analyses: PlayerAnalysis[] }) {
  const total = (key: keyof PlayerStats) => analyses.reduce((sum, item) => sum + item.stats[key], 0)
  const passErrors = analyses.reduce((sum, item) => sum + Math.max(0, item.stats.passes - item.stats.passesSuccess), 0)
  const allErrors = total('turnovers') + total('dispossessed') + passErrors
  return <section className="mt-10"><h2 className="section-title mb-3">全队数据</h2><div className="team-stats"><div className="team-stat"><b>{total('touches')}</b><span>总拿球</span></div><div className="team-stat"><b>{total('passes')}</b><span>总传球</span></div><div className="team-stat"><b>{total('shots')}</b><span>总射门</span></div><div className="team-stat"><b>{allErrors}</b><span>总失误</span></div></div></section>
}

function toTime(total: number) { const min = Math.floor(total / 60); const sec = total % 60; return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}` }
function PlayerCard({ player, analysis }: { player: Player; analysis: PlayerAnalysis }) {
  const s = analysis.stats
  const [showAllEvents, setShowAllEvents] = useState(false)
  const visibleEvents = showAllEvents ? analysis.events : analysis.events.slice(0, 4)
  const passErrors = Math.max(0, s.passes - s.passesSuccess)
  return (
    <article className="panel player-card">
      <header className="player-head"><div><div className="player-name"><span className="player-number">{player.number}</span>{player.name}</div><span className="position">{player.position}</span></div><div className="player-score"><b>{analysis.score.toFixed(1)}</b><span>演示评分 / 10</span></div></header>
      <p className="mt-3 text-xs text-[var(--text-muted)]">演示数据 · 真实分析待接入</p>
      <div className="data-list"><span>拿球 <b>{s.touches}</b></span><span>传球 <b>{s.passesSuccess}/{s.passes}</b></span><span>传球失误 <b>{passErrors}</b></span><span>被断球 <b>{s.dispossessed}</b></span><span>射门 <b>{s.shotsOnTarget}/{s.shots}</b></span><span>突破 <b>{s.dribbles}</b></span><span>拦截 <b>{s.interceptions}</b></span><span>抢断 <b>{s.tackles}</b></span><span>其他失误 <b>{s.turnovers}</b></span></div>
      {analysis.insights.slice(0, 2).map((insight) => <p className="insight" key={insight}>{insight}</p>)}
      <div className="event-list" aria-label={`${player.name} 的事件时间`}>{visibleEvents.map((event) => <span className={`event ${event.outcome === '成功' ? 'success' : ''}`} title={event.note} key={`${event.time}-${event.type}`}>{toTime(event.time)} · {event.type}</span>)}</div>
      {analysis.events.length > 4 && <button className="event-toggle" type="button" onClick={() => setShowAllEvents((current) => !current)}>{showAllEvents ? '收起' : `查看全部 ${analysis.events.length} 个时间点`}</button>}
    </article>
  )
}

function ShareModal({ match, homeShots, summary, onClose }: { match: Match; homeShots: number; summary: MatchSummary; onClose: () => void }) {
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title"><div className="modal-header"><h2 id="share-title" className="text-base font-semibold">球队复盘分享预览</h2><button type="button" className="btn-secondary !min-h-0 !px-2 !py-1" onClick={onClose} aria-label="关闭分享预览">关闭</button></div><div className="modal-content"><div className="share-preview"><p className="text-sm text-[var(--text-secondary)]">{match.name}</p><div className="share-score"><span className="text-[var(--ai)]">{match.teamName}</span><b>{match.myScore} - {match.oppScore}</b><span className="text-[var(--opponent)]">{match.opponentName}</span></div><div className="grid grid-cols-2 gap-3 border-y border-[var(--line)] py-3 text-center text-sm"><span>控球率 <b className="ml-1 font-score text-[var(--ai)]">{match.possessionHome}%</b></span><span>射门 <b className="ml-1 font-score text-[var(--ai)]">{homeShots}:{match.shotsAway}</b></span></div><p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">{summary.headline}</p></div><p className="share-note">演示入口｜分享功能待接入</p></div></section></div>
}

function IdentityNotice({ match }: { match: Match }) {
  if (match.identificationStatus === 'confirmed' && !match.videoName && !match.playerIdentityMap) return null
  const confirmedCount = Object.keys(match.playerIdentityMap ?? {}).length
  if (confirmedCount === match.players.length && confirmedCount > 0) return null
  const skipped = match.identificationStatus === 'skipped'
  const message = confirmedCount
    ? `已确认 ${confirmedCount}/${match.players.length} 名球员；未确认候选不会进入长期个人档案。`
    : skipped
      ? '本次已跳过球员身份确认，全队复盘仍可正常查看。'
      : '球员身份待确认；确认后的数据才可用于长期个人档案。'
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-[var(--line)] bg-[var(--content)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{skipped ? '已跳过身份确认' : '球员身份待补全'}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{message}</p>
      </div>
      <Link className="btn-secondary shrink-0" to={`/match/${match.id}/identify`}>确认球员</Link>
    </div>
  )
}

export default function MatchReport() {
  const { id } = useParams(); const navigate = useNavigate(); const match = id ? getMatch(id) : undefined; const [shareOpen, setShareOpen] = useState(false)
  if (!match) return <div className="page-shell px-4 py-24 text-center"><p className="text-[var(--text-secondary)]">未找到该比赛</p><Link to="/" className="btn-primary mt-6">返回首页</Link></div>
  if (!match.analysis) { navigate(`/match/${match.id}/analyzing`, { replace: true }); return null }
  const analyses = match.analysis; const homeShots = analyses.reduce((sum, a) => sum + a.stats.shots, 0); const teamAvg = analyses.length ? analyses.reduce((sum, a) => sum + a.score, 0) / analyses.length : 0; const summary = buildMatchSummary(match, analyses); const playerMap = new Map(match.players.map((player) => [player.id, player])); const rows = analyses.map((analysis) => ({ analysis, player: playerMap.get(analysis.playerId) })).filter((row): row is { analysis: PlayerAnalysis; player: Player } => Boolean(row.player)).sort((a, b) => b.analysis.score - a.analysis.score)
  return <div className="report-page"><div className="report-shell"><header className="flex items-center justify-between gap-4"><div><Link to="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--ai)]">← 首页</Link><p className="report-meta mt-2">{formatDate(match.date)} · {match.name} · {match.type} · {formatDuration(match.duration)}</p></div><button className="btn-secondary shrink-0" onClick={() => setShareOpen(true)} aria-label="打开球队复盘分享预览">分享球队复盘</button></header><section className="score-hero"><div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)] items-center gap-3 sm:gap-4"><span className="score-team home">{match.teamName}</span><span className="score-number home">{match.myScore}</span><span className="score-dash">—</span><span className="score-number away">{match.oppScore}</span><span className="score-team away">{match.opponentName}</span></div><aside className="team-average col-span-full sm:col-auto"><span>球队平均分</span><b>{teamAvg.toFixed(1)}</b></aside></section><div className="report-divider" /><div className="comparison-grid mt-3"><Comparison label="控球率" home={match.possessionHome ?? 50} away={match.possessionAway ?? 50} suffix="%" /><Comparison label="射门" home={homeShots} away={match.shotsAway ?? 0} /></div><Summary summary={summary} /><IdentityNotice match={match} /><p className="mt-4 text-xs text-[var(--text-muted)]">演示数据：本地模拟分析结果，不代表真实 AI 识别。</p><TeamStats analyses={analyses} /><section className="mt-10"><h2 className="section-title mb-3">球员表现</h2><div className="player-grid">{rows.map(({ player, analysis }) => <PlayerCard key={player.id} player={player} analysis={analysis} />)}</div></section><div className="mt-8 flex justify-end gap-2"><Link className="btn-secondary" to={`/match/${match.id}/analyzing`}>重新分析</Link><button className="btn-secondary !border-[var(--danger)] !text-[var(--danger)]" onClick={() => { if (window.confirm('确定删除这场比赛及其看板吗？')) { deleteMatch(match.id); navigate('/', { replace: true }) } }}>删除</button></div></div>{shareOpen && <ShareModal match={match} homeShots={homeShots} summary={summary} onClose={() => setShareOpen(false)} />}</div>
}
