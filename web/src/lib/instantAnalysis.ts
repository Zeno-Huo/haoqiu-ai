import type { CloudDetectionJob } from '../cloudDetectionTypes'

export interface InstantPair {
  home?: number
  away?: number
}

export interface InstantSummary {
  highlight?: string
  weakness?: string
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

export interface InstantPlayer {
  id: string
  name?: string
  number?: string
  position?: string
  score?: number
  stats: InstantTeamStats
  insights: string[]
  events: InstantEvent[]
}

export interface InstantEvent {
  time?: number
  label?: string
  type?: string
  note?: string
}

export interface InstantAnalysisDashboard {
  score?: InstantPair
  possession?: InstantPair
  shots?: InstantPair
  teamAverage?: number
  summary: InstantSummary
  teamStats: InstantTeamStats
  players: InstantPlayer[]
  events: InstantEvent[]
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
    time: number(first(item, ['time', 'timestamp', 'seconds', '时间'])),
    label: text(first(item, ['label', 'title', 'type', '事件'])) || text(first(item, ['note', 'description', '说明'])),
    type: text(first(item, ['type', 'event_type', '事件'])),
    note: text(first(item, ['note', 'description', '说明'])),
  }
}

function player(value: unknown, index: number): InstantPlayer {
  const item = object(value) || {}
  const insightValue = first(item, ['insights', 'insight', '观察', '特点'])
  const insights = Array.isArray(insightValue) ? insightValue.map(text).filter((item): item is string => Boolean(item)) : [text(insightValue)].filter((item): item is string => Boolean(item))
  const eventValue = first(item, ['events', 'timeline', '事件时间线', '时间线'])
  return {
    id: text(first(item, ['id', 'player_id', '球员'])) || `player-${index}`,
    name: text(first(item, ['name', '姓名'])),
    number: text(first(item, ['number', '号码'])),
    position: text(first(item, ['position', '位置'])),
    score: number(first(item, ['score', 'rating', '评分'])),
    stats: stats(first(item, ['stats', 'statistics', '数据']) || item),
    insights,
    events: Array.isArray(eventValue) ? eventValue.map(event) : [],
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
  const nestedPossession = homeTeam || awayTeam ? { home: first(homeTeam, ['possession_pct', 'possession', '控球率']), away: first(awayTeam, ['possession_pct', 'possession', '控球率']) } : undefined
  const nestedShots = homeTeam || awayTeam ? { home: first(homeTeam, ['shots', '射门']), away: first(awayTeam, ['shots', '射门']) } : undefined
  const summarySource = object(first(source, ['summary', 'team_summary', '球队总结', '观察']))
  const playersValue = first(source, ['players', 'player_cards', 'player_analysis', '球员'])
  const eventsValue = first(source, ['events', 'timeline', 'event_timeline', '事件时间线'])
  const teamStatsValue = first(source, ['teamStats', 'team_stats', '球队数据', 'stats']) ?? first(homeTeam, ['stats', '球队数据'])
  const result: InstantAnalysisDashboard = {
    score: pair(first(source, ['score', '比分'])) || pair(matchScore),
    possession: pair(first(source, ['possession', 'possession_rate', '控球率'])) || pair(nestedPossession),
    shots: pair(first(source, ['shots', '射门'])) || pair(nestedShots),
    teamAverage: number(first(source, ['teamAverage', 'team_average', 'average_score', '球队平均分'])) || number(first(homeTeam, ['average_score', 'averageScore', '球队平均分'])),
    summary: {
      highlight: text(first(summarySource, ['highlight', 'headline', '亮点', '最大亮点'])),
      weakness: text(first(summarySource, ['weakness', 'shortcoming', '不足', '最大不足'])),
      focus: text(first(summarySource, ['focus', 'next_focus', '关注', '下一轮关注'])),
    },
    teamStats: stats(teamStatsValue),
    players: Array.isArray(playersValue) ? playersValue.map(player) : [],
    events: Array.isArray(eventsValue) ? eventsValue.map(event) : [],
  }
  const hasData = Boolean(result.score || result.possession || result.shots || result.teamAverage || result.players.length || result.events.length || Object.keys(result.teamStats).length || Object.values(result.summary).some(Boolean))
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
