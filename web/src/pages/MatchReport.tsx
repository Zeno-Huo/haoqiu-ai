import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteMatch, getMatch } from '../lib/storage'
import { formatDate, formatDuration } from '../lib/utils'
import { buildMatchSummary } from '../lib/engine'
import { useCountUp } from '../hooks/useCountUp'
import type { MatchOutcome, MatchSummary, PlayerAnalysis, PlayerStats, Position } from '../types'

const POS_CLASS: Record<Position, string> = {
  前锋: 'pos-forward',
  中场: 'pos-mid',
  后卫: 'pos-back',
}

/** 卡片 stagger 入场间隔（50–150ms 区间） */
const STAGGER_MS = 70
const FIRST_DELAY_MS = 60

/** 称号勋章：金质奖章 + 光泽 + 弹出动效 */
function Medal({ label }: { label: string }) {
  return (
    <span className="medal medal-pop">
      <span className="medal-coin" aria-hidden>
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 1.6 L12.3 7.1 L18.3 7.6 L13.6 11.6 L15 17.4 L10 14.3 L5 17.4 L6.4 11.6 L1.7 7.6 L7.7 7.1 Z" />
        </svg>
      </span>
      <span className="medal-label">{label}</span>
    </span>
  )
}

const OUTCOME_META: Record<MatchOutcome, { label: string; cls: string }> = {
  win: { label: '胜', cls: 'outcome-win' },
  loss: { label: '负', cls: 'outcome-loss' },
  draw: { label: '平', cls: 'outcome-draw' },
}

/** 胜负标签：胜 / 负 / 平 徽章 */
function OutcomeBadge({ outcome }: { outcome: MatchOutcome }) {
  const { label, cls } = OUTCOME_META[outcome]
  return <span className={`outcome-badge ${cls}`}>{label}</span>
}

export default function MatchReport() {
  const { id } = useParams()
  const navigate = useNavigate()
  const match = id ? getMatch(id) : undefined

  if (!match) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-4xl">😕</p>
        <p className="mt-3 text-slate-600">未找到该比赛</p>
        <Link to="/" className="btn-primary mt-6">
          返回首页
        </Link>
      </div>
    )
  }

  if (!match.analysis) {
    navigate(`/match/${match.id}/analyzing`, { replace: true })
    return null
  }

  const analyses = match.analysis

  // 全队总览
  const totalTouches = analyses.reduce((s, a) => s + a.stats.touches, 0)
  const totalPasses = analyses.reduce((s, a) => s + a.stats.passes, 0)
  const totalShots = analyses.reduce((s, a) => s + a.stats.shots, 0)
  const totalTurnovers = analyses.reduce((s, a) => s + a.stats.turnovers, 0)
  const teamAvg = analyses.length
    ? Math.round((analyses.reduce((s, a) => s + a.score, 0) / analyses.length) * 10) / 10
    : 0

  // 比赛总结：基于客观数据 + 比分胜负推导
  const summary = buildMatchSummary(match, analyses)

  // 球员数据：按综合分降序，「最亮眼者」靠前当主角
  const playerMap = new Map(match.players.map((p) => [p.id, p]))
  const rows = analyses
    .map((a) => ({ player: playerMap.get(a.playerId), analysis: a }))
    .filter((x): x is { player: NonNullable<typeof x.player>; analysis: PlayerAnalysis } => Boolean(x.player))
    .sort((a, b) => b.analysis.score - a.analysis.score)

  return (
    <div className="report-pitch min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-9">
        {/* 看板头 */}
        <header className="animate-fade-in-up mb-6">
          <Link
            to="/"
            className="text-sm font-medium text-[var(--on-board-soft)] transition hover:text-[var(--on-board)]"
          >
            ← 首页
          </Link>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--on-board)] sm:text-4xl">
            {match.teamName}
            <span className="ml-2.5 align-middle text-base font-semibold text-[var(--on-board-soft)]">
              {match.name}
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-[var(--on-board-dim)]">
            {formatDate(match.date)} · {match.type} · {formatDuration(match.duration)} · {match.players.length} 名球员
          </p>
        </header>

        {/* 比分 + 胜负标签 + 球队整体评分 */}
        <ScoreBoard
          teamName={match.teamName}
          myScore={match.myScore}
          oppScore={match.oppScore}
          outcome={summary.outcome}
          teamScore={teamAvg}
        />

        {/* 演示数据说明条 */}
        <div className="demo-note mb-6 flex items-start gap-2 rounded-lg px-4 py-2.5 text-xs leading-relaxed">
          <span className="demo-badge mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold">
            演示数据
          </span>
          <span>
            当前为本地模拟分析结果，尚未接入真实视频 AI 识别；数据、称号与点评由算法按名单与位置生成，仅供演示产品流程。
          </span>
        </div>

        {/* 比赛总结：亮点 / 不足 / 可提升点 */}
        <MatchSummaryBlock summary={summary} />

        {/* 全队记分牌（总览） */}
        <section className="scoreboard card-enter mb-8 p-4 sm:p-5" style={{ animationDelay: '40ms' }}>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--on-board-dim)]">
            全队数据
          </h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5">
            <TeamStat label="总拿球" value={totalTouches} delay={120} />
            <TeamStat label="总传球" value={totalPasses} delay={170} />
            <TeamStat label="总射门" value={totalShots} delay={220} />
            <TeamStat label="总失误" value={totalTurnovers} delay={270} />
            <TeamStat label="全队均分" value={teamAvg} decimals={1} accent delay={320} />
          </div>
        </section>

        {/* 球员表现：谁最亮眼谁当主角 */}
        <section>
          <h2 className="mb-3 flex items-baseline gap-2 text-sm font-black tracking-tight text-[var(--on-board)]">
            球员表现
            <span className="text-xs font-medium text-[var(--on-board-dim)]">亮点放大 · 称号勋章</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {rows.map(({ player, analysis }, i) => (
              <PlayerCard
                key={player.id}
                rank={i + 1}
                name={player.name}
                number={player.number}
                position={player.position}
                analysis={analysis}
                delayMs={FIRST_DELAY_MS + i * STAGGER_MS}
              />
            ))}
          </div>
        </section>

        {/* 操作 */}
        <div className="mt-8 flex justify-end gap-2">
          <Link to={`/match/${match.id}/analyzing`} className="btn-secondary !px-4 !py-2 text-xs">
            重新分析
          </Link>
          <button
            className="btn-secondary !px-4 !py-2 text-xs text-red-500 hover:bg-red-50"
            onClick={() => {
              if (window.confirm('确定删除这场比赛及其看板吗？')) {
                deleteMatch(match.id)
                navigate('/', { replace: true })
              }
            }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

function TeamStat({
  label,
  value,
  accent = false,
  decimals = 0,
  delay = 0,
}: {
  label: string
  value: number
  accent?: boolean
  decimals?: number
  delay?: number
}) {
  const v = useCountUp(value, { delay })
  const display = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString()
  return (
    <div>
      <div
        className={`font-score text-2xl font-black tabular-nums ${
          accent ? 'text-[var(--gold)]' : 'text-[var(--on-board)]'
        }`}
      >
        {display}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--on-board-dim)]">{label}</div>
    </div>
  )
}

/** 比分 + 胜负标签 + 球队整体评分 */
function ScoreBoard({
  teamName,
  myScore,
  oppScore,
  outcome,
  teamScore,
}: {
  teamName: string
  myScore: number
  oppScore: number
  outcome: MatchOutcome
  teamScore: number
}) {
  const my = useCountUp(myScore, { delay: 80 })
  const opp = useCountUp(oppScore, { delay: 140 })
  const ts = useCountUp(teamScore, { delay: 200 })

  return (
    <section className="scoreboard card-enter mb-6 p-4 sm:p-6" style={{ animationDelay: '20ms' }}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto] sm:items-stretch">
        {/* 比分 */}
        <div>
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--on-board-dim)]">
            比赛比分
          </h2>
          <div className="score-well relative flex items-center justify-center gap-3 px-4 py-5 sm:gap-4">
            <span className="max-w-[9rem] truncate text-sm font-bold text-[var(--on-board-soft)]">{teamName}</span>
            <span className="score-number">{Math.round(my)}</span>
            <span className="score-colon">:</span>
            <span className="score-number">{Math.round(opp)}</span>
            <span className="text-sm font-bold text-[var(--on-board-soft)]">对手</span>
          </div>
          <div className="mt-3 flex justify-center">
            <OutcomeBadge outcome={outcome} />
          </div>
        </div>
        {/* 球队整体评分 */}
        <div className="sm:w-44">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--on-board-dim)]">
            球队整体评分
          </h2>
          <div className="score-well relative flex h-full min-h-[92px] flex-col items-center justify-center px-4 py-4">
            <span className="score-number">{ts.toFixed(1)}</span>
            <span className="mt-1.5 text-[10px] tracking-[0.16em] text-[var(--on-board-dim)]">/ 10 分</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 比赛总结：按胜负展示最大亮点 / 不足 / 可提升点 */
function MatchSummaryBlock({ summary }: { summary: MatchSummary }) {
  return (
    <section className="scoreboard card-enter mb-8 p-4 sm:p-5" style={{ animationDelay: '60ms' }}>
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--on-board-dim)]">
        比赛总结
        <OutcomeBadge outcome={summary.outcome} />
      </h2>
      <p className="summary-headline">{summary.headline}</p>
      {summary.points.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-[var(--board-line)] pt-3">
          {summary.points.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-[var(--on-board-soft)]">
              <span className="mt-0.5 shrink-0 font-bold text-[var(--gold)]">·</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PlayerCard({
  rank,
  name,
  number,
  position,
  analysis,
  delayMs,
}: {
  rank: number
  name: string
  number: string
  position: Position
  analysis: PlayerAnalysis
  delayMs: number
}) {
  const s: PlayerStats = analysis.stats
  const hl = analysis.highlight
  const title = analysis.title

  // 亮点大数字与综合分：卡片浮现后开始滚动
  const hlVal = useCountUp(hl ? hl.value : 0, { delay: delayMs + 120 })
  const scoreVal = useCountUp(analysis.score, { delay: delayMs + 120 })

  return (
    <article className="scoreboard card-enter p-4 sm:p-5" style={{ animationDelay: `${delayMs}ms` }}>
      {/* 身份行：名次 + 姓名/号码 + 位置徽章 | 称号勋章 */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`font-score text-2xl font-black tabular-nums leading-none ${
              rank === 1 ? 'text-[var(--gold)]' : 'text-[var(--on-board-dim)]'
            }`}
          >
            {rank}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="truncate text-lg font-black leading-tight text-[var(--on-board)]">{name}</span>
              <span className="shrink-0 font-score text-sm font-bold text-[var(--on-board-soft)]">
                #{number}
              </span>
            </div>
            <span className={`pos-chip mt-1 ${POS_CLASS[position]}`}>{position}</span>
          </div>
        </div>
        {title && <Medal label={title} />}
      </div>

      {/* 亮点：记分牌大数字 + 右上角弱化综合分 */}
      <div className="score-well relative flex items-end gap-4 px-4 py-3">
        <div className="flex items-baseline gap-2.5">
          <span className="score-digit">{Math.round(hlVal)}</span>
          <span className="score-unit">{hl ? hl.label : '—'}</span>
        </div>
        <div className="score-corner">
          <span className="score-corner-num">{scoreVal.toFixed(1)}</span>
          <span className="score-corner-label">综合</span>
        </div>
      </div>

      {/* 辅助数据：一行小字 */}
      <div className="mt-3.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-relaxed text-[var(--on-board-dim)]">
        <span>
          拿球 <b className="font-bold text-[var(--on-board-soft)]">{s.touches}</b>
        </span>
        <span>
          传球 <b className="font-bold text-[var(--on-board-soft)]">{s.passesSuccess}</b>/{s.passes}
        </span>
        <span>
          射门 <b className="font-bold text-[var(--on-board-soft)]">{s.shotsOnTarget}</b>/{s.shots}
        </span>
        <span>
          突破 <b className="font-bold text-[var(--on-board-soft)]">{s.dribbles}</b>
        </span>
        <span>
          拦截 <b className="font-bold text-[var(--on-board-soft)]">{s.interceptions}</b>
        </span>
        <span>
          抢断 <b className="font-bold text-[var(--on-board-soft)]">{s.tackles}</b>
        </span>
        <span>
          失误 <b className="font-bold text-[var(--on-board-soft)]">{s.turnovers}</b>
        </span>
      </div>

      {/* 分析点评 */}
      {analysis.insights.length > 0 && (
        <div className="mt-3 border-t border-[var(--board-line)] pt-3">
          <ul className="space-y-1">
            {analysis.insights.map((ins, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-[var(--on-board-soft)]">
                <span className="mt-0.5 shrink-0 font-bold text-[var(--gold)]">·</span>
                <span>{ins}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
