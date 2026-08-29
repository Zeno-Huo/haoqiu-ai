import type { CloudDetectionJob } from '../cloudDetectionTypes'

export interface InstantPair {
  home?: number
  away?: number
}

export interface InstantSummary {
  overall?: string
  highlight?: string
  weakness?: string
  recommendation?: string
  /** 兼容旧接口中的下一步关注字段。 */
  focus?: string
}

export interface InstantTeamStats {
  touches?: number
  passes?: number
  passesSuccess?: number
  passErrors?: number
  shots?: number
  shotsOnTarget?: number
  turnovers?: number
  dispossessed?: number
  interceptions?: number
  tackles?: number
  goals?: number
  assists?: number
}

/** 动作矫正（L4）：模型针对某一个技术动作的观察与建议。 */
export interface TechniqueNote {
  /** 动作维度，如"射门""传球""停球"。 */
  aspect?: string
  /** 画面里实际观察到的动作。 */
  observed?: string
  /** 这个动作的问题；没有明显问题时为空。 */
  issue?: string
  /** 具体可执行的矫正建议。 */
  advice?: string
  playerNumber?: string
}

export interface InstantPlayer {
  id: string
  name?: string
  number?: string
  /** 无号码球员的顺序编号（从 1 开始）。有真实号码时为 undefined。 */
  anonymousIndex?: number
  /** 从表现推断的角色（如"进攻尖刀"）。位置识别实测会认错，已不再使用。 */
  role?: string
  /** 2~4 个关键词标签。 */
  tags: string[]
  /** 本场最佳。 */
  isMvp: boolean
  score?: number
  title?: string
  highlight?: { label?: string; value?: number; note?: string }
  stats: InstantTeamStats
  insights: string[]
  events: InstantEvent[]
  /** 动作矫正（L4）：模型对该球员技术动作的点评与建议。 */
  techniques?: TechniqueNote[]
}

export interface InstantEvent {
  /** 视频内秒数。 */
  time?: number
  /** 画面记分牌读到的比赛时间文本（如 "23:41"），读不到为空。 */
  clock?: string
  label?: string
  type?: string
  note?: string
}

/** 比分来源：记分牌读取 / 由进球事件推导 / 未识别（可手动补充）。 */
export type InstantScoreSource = 'scoreboard' | 'events' | 'unknown'

export interface InstantAnalysisDashboard {
  score?: InstantPair
  scoreSource: InstantScoreSource
  scoreNote?: string
  shots?: InstantPair
  teamAverage?: number
  summary: InstantSummary
  teamStats: InstantTeamStats
  players: InstantPlayer[]
  events: InstantEvent[]
  /** 全队动作矫正总建议（L4）。 */
  techniqueSummary?: string
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function first(value: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!value) return undefined
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key]
  return undefined
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** 支持 {home,away}、{our,opponent} 和 [我方,对方] 三种后端输出。 */
function pair(value: unknown): InstantPair | undefined {
  if (Array.isArray(value)) {
    const result = { home: number(value[0]), away: number(value[1]) }
    return result.home === undefined && result.away === undefined ? undefined : result
  }
  const item = object(value)
  if (!item) return undefined
  const result = {
    home: number(first(item, ['home', 'our', 'team', 'my', '我方', '主队'])),
    away: number(first(item, ['away', 'opponent', 'opp', 'opposition', '对方', '客队'])),
  }
  return result.home === undefined && result.away === undefined ? undefined : result
}

function stats(value: unknown): InstantTeamStats {
  const item = object(value)
  if (!item) return {}
  return {
    touches: number(first(item, ['touches', 'touch', '拿球', '触球'])),
    passes: number(first(item, ['passes', 'pass', '传球'])),
    passesSuccess: number(first(item, ['passesSuccess', 'pass_success', 'successful_passes', '传球成功'])),
    passErrors: number(first(item, ['passErrors', 'pass_errors', '传球失误'])),
    shots: number(first(item, ['shots', '射门'])),
    shotsOnTarget: number(first(item, ['shotsOnTarget', 'shots_on_target', '射正'])),
    turnovers: number(first(item, ['turnovers', 'errors', '失误', '其他失误'])),
    dispossessed: number(first(item, ['dispossessed', '被断球', '被断'])),
    interceptions: number(first(item, ['interceptions', '拦截'])),
    tackles: number(first(item, ['tackles', '抢断'])),
    goals: number(first(item, ['goals', '进球'])),
    assists: number(first(item, ['assists', '助攻'])),
  }
}

function event(value: unknown): InstantEvent {
  const item = object(value)
  if (!item) return { label: text(value) }
  return {
    time: number(first(item, ['time', 'time_seconds', 'timestamp', 'seconds', '时间'])),
    clock: text(first(item, ['clock', 'match_clock', 'game_clock', '比赛时间'])),
    // 描述优先于类型：note 更具体（"远射偏出"胜过 "shot"）
    label: text(first(item, ['note', 'description', '说明'])) || text(first(item, ['label', 'title', '事件'])),
    type: text(first(item, ['type', 'event_type', '事件'])),
    note: text(first(item, ['note', 'description', '说明'])),
  }
}

/** 单条动作矫正；observed 与 advice 都为空时丢弃，避免前端渲染空白卡片。 */
function technique(value: unknown): TechniqueNote | undefined {
  const item = object(value)
  if (!item) return undefined
  const observed = text(first(item, ['observed', 'observation', '观察', '动作']))
  const advice = text(first(item, ['advice', 'suggestion', '建议', '矫正建议']))
  if (!observed && !advice) return undefined
  return {
    playerNumber: text(first(item, ['player_number', 'playerNumber', '号码'])),
    aspect: text(first(item, ['aspect', 'dimension', '维度', '动作类型'])),
    observed,
    issue: text(first(item, ['issue', 'problem', '问题'])),
    advice,
  }
}

function player(value: unknown, index: number): InstantPlayer {
  const item = object(value) || {}
  const insightValue = first(item, ['insights', 'insight', 'notes', 'note', '观察', '特点', '点评'])
  const insights = Array.isArray(insightValue) ? insightValue.map(text).filter((item): item is string => Boolean(item)) : [text(insightValue)].filter((item): item is string => Boolean(item))
  const tagValue = first(item, ['tags', 'keywords', '标签'])
  const tags = (Array.isArray(tagValue) ? tagValue.map(text) : [text(tagValue)]).filter((item): item is string => Boolean(item)).slice(0, 4)
  const eventValue = first(item, ['events', 'timeline', '事件时间线', '时间线'])
  return {
    id: text(first(item, ['id', 'player_id', '球员'])) || `player-${index}`,
    name: text(first(item, ['name', '姓名'])),
    number: text(first(item, ['number', '号码'])),
    anonymousIndex: number(first(item, ['anonymous_index', 'anonymousIndex', '无号码编号'])),
    role: text(first(item, ['role', '角色'])),
    tags,
    isMvp: first(item, ['is_mvp', 'isMvp', 'mvp']) === true,
    score: number(first(item, ['score', 'rating', '评分'])),
    title: text(first(item, ['title', '称号'])),
    highlight: (() => {
      const itemValue = object(first(item, ['highlight', '亮点']))
      if (!itemValue) return undefined
      return {
        label: text(first(itemValue, ['label', 'name', '指标', '名称'])),
        value: number(first(itemValue, ['value', '数值'])),
        note: text(first(itemValue, ['note', 'description', '说明'])),
      }
    })(),
    stats: stats(first(item, ['stats', 'statistics', '数据']) || item),
    insights,
    events: Array.isArray(eventValue) ? eventValue.map(event) : [],
    techniques: (() => {
      const techValue = first(item, ['techniques', 'technique', 'coaching', '动作矫正', '技术动作'])
      if (!Array.isArray(techValue)) return undefined
      const list = techValue.map(technique).filter((item): item is TechniqueNote => Boolean(item))
      return list.length ? list : undefined
    })(),
  }
}

function parseJson(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) } catch { return undefined }
}

/** 将后端未来可能采用的 analysis/dashboard 包装统一成前端看板模型。 */
export function normalizeInstantDashboard(value: unknown): InstantAnalysisDashboard | undefined {
  const root = object(value)
  if (!root) return undefined
  const source = object(first(root, ['analysis', 'dashboard', '看板'])) || root
  const match = object(first(source, ['match', '比赛']))
  const teams = object(first(source, ['teams', '球队']))
  const homeTeam = object(first(teams, ['home', '主队', '我方']))
  const awayTeam = object(first(teams, ['away', '客队', '对方']))
  const matchScore = first(match, ['score', '比分'])
  const scoreSourceRaw = text(first(match, ['score_source', 'scoreSource'])) || text(first(source, ['score_source', 'scoreSource']))
  const scoreSource: InstantScoreSource = scoreSourceRaw === 'scoreboard' ? 'scoreboard' : scoreSourceRaw === 'events' ? 'events' : 'unknown'
  const nestedShots = homeTeam || awayTeam ? { home: first(homeTeam, ['shots', 'shots_on_target', '明显射门', '射门']), away: first(awayTeam, ['shots', 'shots_on_target', '明显射门', '射门']) } : undefined
  const summarySource = object(first(source, ['summary', 'team_summary', '球队总结', '观察']))
  const playersValue = first(source, ['players', 'player_cards', 'player_analysis', '球员'])
  const eventsValue = first(source, ['events', 'timeline', 'event_timeline', '事件时间线'])
  const teamStatsValue = first(source, ['teamStats', 'team_stats', '球队数据', 'stats']) ?? first(homeTeam, ['stats', '球队数据'])
  const result: InstantAnalysisDashboard = {
    score: pair(first(source, ['score', '比分'])) || pair(matchScore),
    scoreSource,
    scoreNote: text(first(match, ['score_note', 'scoreNote'])),
    shots: pair(first(source, ['shots', 'clear_shots', 'shots_on_target', '明显射门', '射门'])) || pair(nestedShots),
    teamAverage: number(first(source, ['teamAverage', 'team_average', 'average_score', '球队平均分'])) || number(first(homeTeam, ['average_score', 'averageScore', '球队平均分'])),
    summary: {
      overall: text(first(summarySource, ['overall', 'overall_review', 'headline', '一句话总评', '总评', 'summary', '总结'])) || text(first(source, ['overall', 'overall_review', '一句话总评', '总评', 'summary', '总结'])),
      highlight: text(first(summarySource, ['highlight', '亮点', '最大亮点'])) || text(first(source, ['highlight', '亮点', '最大亮点'])),
      weakness: text(first(summarySource, ['weakness', 'shortcoming', '不足', '最大不足'])) || text(first(source, ['weakness', 'shortcoming', '不足', '最大不足'])),
      recommendation: text(first(summarySource, ['recommendation', 'next_step', 'next_phase', '下一阶段建议', '下一步建议'])) || text(first(source, ['recommendation', 'next_step', 'next_phase', '下一阶段建议', '下一步建议'])),
      focus: text(first(summarySource, ['focus', 'next_focus', '关注', '下一轮关注'])) || text(first(source, ['focus', 'next_focus', '关注', '下一轮关注'])),
    },
    teamStats: stats(teamStatsValue),
    players: Array.isArray(playersValue) ? playersValue.map(player) : [],
    events: Array.isArray(eventsValue) ? eventsValue.map(event) : [],
    techniqueSummary: text(first(source, ['technique_summary', 'techniqueSummary', 'coaching_summary', '动作矫正总结'])),
  }
  const hasData = Boolean(result.score || result.shots || result.teamAverage || result.players.length || result.events.length || result.techniqueSummary || Object.keys(result.teamStats).length || Object.values(result.summary).some(Boolean) || result.players.some((player) => (player.techniques?.length ?? 0) > 0))
  return hasData ? result : undefined
}

export function parseInstantAnalysis(job: CloudDetectionJob): { dashboard?: InstantAnalysisDashboard; narrative?: string } {
  const content = job.text_result?.content?.trim()
  const rawContent = job.text_result?.raw_content?.trim() || content
  const parsedContent = rawContent ? parseJson(rawContent) : undefined
  const dashboard = normalizeInstantDashboard(job.analysis) || normalizeInstantDashboard(job.dashboard) || normalizeInstantDashboard(job.text_result?.structured) || normalizeInstantDashboard(job.text_result?.analysis) || normalizeInstantDashboard(job.text_result?.dashboard) || normalizeInstantDashboard(parsedContent)
  const narrative = content && !parsedContent ? content : text(object(parsedContent)?.narrative) || text(object(parsedContent)?.summary)
  return { dashboard, narrative }
}
