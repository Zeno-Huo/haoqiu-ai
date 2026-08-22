// 本地模拟 AI 分析引擎
// 生成「真实感、确定性」的客观数据，未来可替换为真实视觉模型管线。
// 对外暴露 analyzeMatch() 接口，后续接入 YOLO/ByteTrack/视觉大模型时仅需替换本文件实现。

import type {
  EventOutcome,
  EventType,
  Match,
  MatchOutcome,
  MatchSummary,
  Player,
  PlayerAnalysis,
  PlayerEvent,
  PlayerStats,
  Position,
} from '../types'
import { createRng, type Rng } from './seed'

// ---------------------------------------------------------------------------
// 评分规则（1-10，有据可依）
// 基准 6 分：正向事件加分、失误扣分，最终 clamp 到 [3, 10] 并保留 1 位小数。
// 权重保证「数据好 → 分高」，且每一项都能解释。
// ---------------------------------------------------------------------------

const SCORE_BASE = 6
const SCORE_MIN = 3
const SCORE_MAX = 10

const SCORE_WEIGHTS: Record<keyof Pick<PlayerStats, 'touchesSuccess' | 'passesSuccess' | 'shotsOnTarget' | 'dribbles' | 'interceptions' | 'tackles' | 'turnovers'>, number> = {
  touchesSuccess: 0.2, // 拿球成功
  passesSuccess: 0.25, // 传球成功
  shotsOnTarget: 0.5, // 射正（威胁最大）
  dribbles: 0.4, // 突破
  interceptions: 0.3, // 拦截
  tackles: 0.3, // 抢断
  turnovers: 0.6, // 失误（扣分）
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 事件类型加权池：按场上位置区分侧重（前锋射门/突破多，中场传球/拿球多，后卫拦截/抢断多） */
const EVENT_POOL_BY_POSITION: Record<Position, EventType[]> = {
  前锋: ['射门', '射门', '射门', '突破', '突破', '突破', '拿球', '拿球', '传球', '传球'],
  中场: ['传球', '传球', '传球', '传球', '拿球', '拿球', '拿球', '突破', '射门', '拦截'],
  后卫: ['拦截', '拦截', '拦截', '抢断', '抢断', '抢断', '拿球', '拿球', '传球', '传球'],
}

/**
 * 事件时间轴：根据球员位置与隐藏「能力水平」生成侧重与结果不同的事件。
 * 事件时间必须落在真实视频时长内；短视频按实际秒数分布，避免「22 秒视频却出现 1 分多钟瞬间」的矛盾。
 */
function buildEvents(match: Match, position: Position, skill: number, rng: Rng): PlayerEvent[] {
  const maxT = Math.max(match.duration - 1, 10)
  const count = Math.min(rng.int(9, 13), maxT + 1)
  const times = new Set<number>()
  const events: PlayerEvent[] = []

  // 能力越强，成功概率越高、失误概率越低
  const goodP = clamp(0.3 + skill * 0.5, 0.3, 0.75)
  const midP = 0.25

  const pool = EVENT_POOL_BY_POSITION[position]

  for (let i = 0; i < count; i++) {
    let t = rng.int(0, maxT)
    while (times.has(t)) t = rng.int(0, maxT)
    times.add(t)

    const type = rng.pick(pool)
    const roll = rng.next()
    const outcome: EventOutcome = roll < goodP ? '成功' : roll < goodP + midP ? '一般' : '失误'

    events.push({ time: t, type, outcome, note: noteFor(type, outcome) })
  }

  return events.sort((a, b) => a.time - b.time)
}

function noteFor(type: EventType, outcome: EventOutcome): string {
  const good = outcome === '成功' ? '处理干脆，效果理想' : outcome === '失误' ? '处理欠佳，出现失误' : '中规中矩'
  const scene: Record<EventType, string> = {
    拿球: '接队友来球',
    传球: '向前送出传球',
    射门: '起脚射门',
    突破: '尝试突破防守',
    拦截: '拦截对方传球',
    抢断: '上抢断球',
  }
  return `${scene[type]}，${good}`
}

/** 从事件聚合出客观数据统计（10 项） */
function buildStats(events: PlayerEvent[]): PlayerStats {
  const count = (type: EventType, outcome?: EventOutcome) =>
    events.filter((e) => e.type === type && (!outcome || e.outcome === outcome)).length

  return {
    touches: count('拿球'),
    touchesSuccess: count('拿球', '成功'),
    turnovers: events.filter((e) => e.outcome === '失误').length,
    passes: count('传球'),
    passesSuccess: count('传球', '成功'),
    shots: count('射门'),
    shotsOnTarget: count('射门', '成功'),
    dribbles: count('突破', '成功'),
    interceptions: count('拦截', '成功'),
    tackles: count('抢断', '成功'),
  }
}

/** 由客观 stats 推导 1-10 综合分（独立导出以便对评分规则做单元级验证） */
export function scoreFromStats(s: PlayerStats): number {
  const raw =
    SCORE_BASE +
    s.touchesSuccess * SCORE_WEIGHTS.touchesSuccess +
    s.passesSuccess * SCORE_WEIGHTS.passesSuccess +
    s.shotsOnTarget * SCORE_WEIGHTS.shotsOnTarget +
    s.dribbles * SCORE_WEIGHTS.dribbles +
    s.interceptions * SCORE_WEIGHTS.interceptions +
    s.tackles * SCORE_WEIGHTS.tackles -
    s.turnovers * SCORE_WEIGHTS.turnovers
  return Math.round(clamp(raw, SCORE_MIN, SCORE_MAX) * 10) / 10
}

/** 基于客观 stats 生成分析点评（每句都能追溯到具体数据，不是空话） */
function buildInsights(s: PlayerStats): string[] {
  const out: string[] = []
  if (s.touches >= 6 && s.turnovers <= 1) {
    out.push('拿球处理稳健，失误控制出色')
  } else if (s.turnovers >= 3) {
    out.push(`本场失误 ${s.turnovers} 次，第一脚处理与护球需加强`)
  } else if (s.touches <= 2) {
    out.push('拿球次数偏少，可更主动要球接应')
  }
  if (s.passes > 0) {
    const rate = s.passesSuccess / s.passes
    if (rate >= 0.7) out.push(`传球成功率 ${Math.round(rate * 100)}%，串联到位`)
    else if (s.passes >= 4) out.push('传球成功率偏低，出球选择可更稳妥')
  }
  if (s.shots >= 2) out.push(`射门 ${s.shots} 次、射正 ${s.shotsOnTarget} 次，进攻有威胁`)
  if (s.interceptions + s.tackles >= 3) out.push('防守积极，多次破坏对手进攻')
  if (s.dribbles >= 2) out.push(`成功突破 ${s.dribbles} 次，1v1 有冲击力`)
  if (out.length === 0) out.push('本场表现中规中矩，建议赛后针对性强化弱项')
  return out.slice(0, 2)
}

/** 分析单个球员 */
function analyzePlayer(match: Match, player: Player): PlayerAnalysis {
  const rng = createRng(`${match.id}:${player.id}:${player.name}`)
  const skill = 0.3 + rng.next() * 0.55 // 隐藏能力水平 0.3 ~ 0.85
  const events = buildEvents(match, player.position, skill, rng)
  const stats = buildStats(events)
  const score = scoreFromStats(stats)
  const insights = buildInsights(stats)

  return {
    id: `pa_${player.id}`,
    matchId: match.id,
    playerId: player.id,
    score,
    stats,
    insights,
    events,
  }
}

// ---------------------------------------------------------------------------
// 称号系统（全队评比）与亮点项（位置重点指标）
// ---------------------------------------------------------------------------

/** 全队评比称号：某指标全队第一时授予对应称号 */
interface TitleDef {
  key: keyof PlayerStats
  label: string
}

const TITLE_DEFS: TitleDef[] = [
  { key: 'shots', label: '射手' }, // 射门最多
  { key: 'dribbles', label: '突破王' }, // 突破成功最多
  { key: 'passesSuccess', label: '传球大师' }, // 传球成功最多
  { key: 'touches', label: '拿球王' }, // 拿球最多
  { key: 'interceptions', label: '拦截王' }, // 拦截最多
  { key: 'tackles', label: '抢断王' }, // 抢断最多
]

/** 位置 → 重点指标（亮点候选）：前锋看进攻、中场看组织、后卫看防守 */
const FOCUS_METRICS: Record<Position, { key: keyof PlayerStats; label: string }[]> = {
  前锋: [
    { key: 'shots', label: '射门' },
    { key: 'dribbles', label: '突破' },
  ],
  中场: [
    { key: 'passes', label: '传球' },
    { key: 'touches', label: '拿球' },
  ],
  后卫: [
    { key: 'interceptions', label: '拦截' },
    { key: 'tackles', label: '抢断' },
  ],
}

/**
 * 为每名球员生成「称号」与「亮点项」。
 * - 称号：仅当该球员在某指标全队第一（且该指标最大值 > 0）时授予；并列第一者共享称号；
 *   若多项第一，取他最突出的一项（数值最高者优先，同值优先位置重点指标，再按固定顺序）。
 * - 亮点项：取该球员「位置重点指标」里数值最高的一项（同值取顺序靠前者），用于看板放大展示。
 * 独立导出以便对边界情况（全 0 / 并列 / 单球员 / 极值）做单元级验证。
 */
export function assignTitlesAndHighlights(analyses: PlayerAnalysis[], players: Player[]): void {
  const playerById = new Map(players.map((p) => [p.id, p]))

  // 1. 计算每项称号指标的全队最大值
  const maxByKey = new Map<keyof PlayerStats, number>()
  for (const def of TITLE_DEFS) {
    let max = 0
    for (const a of analyses) max = Math.max(max, a.stats[def.key])
    maxByKey.set(def.key, max)
  }

  for (const a of analyses) {
    const position = playerById.get(a.playerId)?.position ?? '中场'

    // 2. 称号：候选 = 全队第一且该指标最大值为正
    const candidates = TITLE_DEFS.filter(
      (d) => (maxByKey.get(d.key) ?? 0) > 0 && a.stats[d.key] === (maxByKey.get(d.key) ?? 0),
    )
    if (candidates.length > 0) {
      const focusKeys = FOCUS_METRICS[position].map((m) => m.key)
      candidates.sort((x, y) => {
        const vx = a.stats[x.key]
        const vy = a.stats[y.key]
        if (vx !== vy) return vy - vx // 数值高者更「突出」
        const fx = focusKeys.includes(x.key) ? 0 : 1 // 同值：位置重点指标优先
        const fy = focusKeys.includes(y.key) ? 0 : 1
        if (fx !== fy) return fx - fy
        return TITLE_DEFS.indexOf(x) - TITLE_DEFS.indexOf(y) // 仍并列：按固定顺序
      })
      a.title = candidates[0].label
    }

    // 3. 亮点项：位置重点指标里数值最高的一项
    const focus = FOCUS_METRICS[position]
    const best = focus.reduce((acc, m) => (a.stats[m.key] > a.stats[acc.key] ? m : acc), focus[0])
    a.highlight = { key: best.key, label: best.label, value: a.stats[best.key] }
  }
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/** 分析整场比赛，为每名球员生成客观数据与综合评分（确定性，结果可重复） */
export function analyzeMatch(match: Match): PlayerAnalysis[] {
  const analyses = match.players.map((p) => analyzePlayer(match, p))
  assignTitlesAndHighlights(analyses, match.players)
  return analyses
}

// ---------------------------------------------------------------------------
// 比赛总结（比分 + 胜负 → 最大亮点 / 不足 / 可提升点）
// ---------------------------------------------------------------------------

function pct(rate: number): number {
  return Math.round(rate * 100)
}

/**
 * 基于客观数据 + 胜负生成比赛总结，每句都落到具体数字、可追溯到全队 stats 汇总。
 * - 赢 / 平：headline 取全队「最大亮点」，points 补充「不足」（不足为空则补次亮点）。
 * - 输：headline 取全队「最大可提升点」，points 补充其余短板。
 * 全队口径：总失误、传球成功率、射门/射正、拦截+抢断。
 */
export function buildMatchSummary(match: Match, analyses: PlayerAnalysis[]): MatchSummary {
  const my = match.myScore ?? 0
  const opp = match.oppScore ?? 0
  const outcome: MatchOutcome = my > opp ? 'win' : my < opp ? 'loss' : 'draw'

  const sum = (k: keyof PlayerStats) => analyses.reduce((s, a) => s + a.stats[k], 0)
  const totalPasses = sum('passes')
  const totalPassesSuccess = sum('passesSuccess')
  const totalShots = sum('shots')
  const totalShotsOnTarget = sum('shotsOnTarget')
  const totalTurnovers = sum('turnovers')
  const defense = sum('interceptions') + sum('tackles')

  const passRate = totalPasses > 0 ? totalPassesSuccess / totalPasses : 0
  const shotRate = totalShots > 0 ? totalShotsOnTarget / totalShots : 0

  // 亮点候选（正向，按显著程度依次尝试）
  const highlights: string[] = []
  if (totalShots > 0 && shotRate >= 0.5) {
    highlights.push(`射门 ${totalShots} 次、射正 ${totalShotsOnTarget} 次，门前效率高`)
  }
  if (totalPasses > 0 && passRate >= 0.7) {
    highlights.push(`传球成功率 ${pct(passRate)}%，串联流畅`)
  }
  if (defense >= 6) {
    highlights.push(`拦截+抢断 ${defense} 次，防守强硬`)
  }
  // 兜底：上述高门槛都不满足时，退化为「有正向数据」的客观陈述
  if (highlights.length === 0) {
    if (totalPasses > 0) highlights.push(`全队完成 ${totalPasses} 次传球，跑动接应积极`)
    else if (totalShots > 0) highlights.push(`全队尝试 ${totalShots} 次射门，敢于起脚`)
    else if (defense > 0) highlights.push(`全队 ${defense} 次拦截+抢断，防守有贡献`)
  }

  // 短板候选（负向，按严重程度依次尝试）
  const weaknesses: string[] = []
  if (totalTurnovers >= 3) {
    weaknesses.push(`全队失误 ${totalTurnovers} 次，控球处理需加强`)
  }
  if (totalPasses >= 4 && passRate < 0.6) {
    weaknesses.push(`传球成功率仅 ${pct(passRate)}%，配合是短板`)
  }
  if (totalShots >= 3 && shotRate < 0.4) {
    weaknesses.push(`射正率仅 ${pct(shotRate)}%，门前把握需提升`)
  }

  if (outcome === 'loss') {
    const headline =
      weaknesses[0] ??
      `比分 ${my}:${opp} 落败，全场 ${totalShots} 次射门、${totalShotsOnTarget} 次射正，把握机会是重点`
    return { outcome, headline, points: weaknesses.slice(1) }
  }

  const headline =
    highlights[0] ?? `比分 ${my}:${opp}，全队传球 ${totalPasses} 次、失误 ${totalTurnovers} 次，整体节奏稳定`
  // 赢 / 平：先给不足，不足为空时补次亮点
  const points = weaknesses.length > 0 ? weaknesses : highlights.slice(1)
  return { outcome, headline, points }
}
