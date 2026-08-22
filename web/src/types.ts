// 好球Ai · MVP 阶段一 数据类型定义

export type MatchType = '5v5' | '7v7' | '11v11'

/** 场上位置（门将暂不做） */
export type Position = '前锋' | '中场' | '后卫'

export const POSITIONS: Position[] = ['前锋', '中场', '后卫']

/** 球员 */
export interface Player {
  id: string
  name: string
  number: string
  position: Position
}

/** 比赛 */
export interface Match {
  id: string
  name: string
  date: string // YYYY-MM-DD
  type: MatchType
  duration: number // 比赛时长（秒）
  teamName: string // 我的队名
  myScore: number // 我方进球
  oppScore: number // 对方进球
  players: Player[]
  analysis?: PlayerAnalysis[]
  createdAt: number
}

/** 比赛胜负结果 */
export type MatchOutcome = 'win' | 'loss' | 'draw'

/** 比赛总结：按胜负推导出的结构化结论 */
export interface MatchSummary {
  outcome: MatchOutcome
  headline: string // 主结论（赢/平：最大亮点；输：最大可提升点）
  points: string[] // 补充要点（不足 / 其余可提升点 / 次亮点）
}

/** 球员客观数据统计（10 项，全部来自视频中可观察的事件） */
export interface PlayerStats {
  touches: number // 拿球次数（接球/触球总次数）
  touchesSuccess: number // 拿球成功次数
  turnovers: number // 失误次数（丢球、停球/处理失误）
  passes: number // 传球次数
  passesSuccess: number // 传球成功次数
  shots: number // 射门次数
  shotsOnTarget: number // 射正次数
  dribbles: number // 突破成功次数
  interceptions: number // 拦截次数
  tackles: number // 抢断次数
}

/** 亮点项：看板中放大展示的单条数据 */
export interface Highlight {
  key: string
  label: string
  value: number
}

/** 个人事件类型 */
export type EventType = '拿球' | '传球' | '射门' | '突破' | '拦截' | '抢断'

export type EventOutcome = '成功' | '失误' | '一般'

export interface PlayerEvent {
  time: number // 秒
  type: EventType
  outcome: EventOutcome
  note: string
}

/** 球员个人分析结果 */
export interface PlayerAnalysis {
  id: string
  matchId: string
  playerId: string
  score: number // 1-10 综合评分，保留 1 位小数，由 stats 客观推导
  stats: PlayerStats
  insights: string[] // 基于客观数据的分析点评
  events: PlayerEvent[]
  title?: string // 称号（如「抢断王」），全队某指标第一时授予，无称号可为空
  highlight?: Highlight // 亮点项（位置重点指标里该球员最突出者），用于看板放大展示
}

export const MATCH_TYPES: MatchType[] = ['5v5', '7v7', '11v11']

export const MATCH_TYPE_DESC: Record<MatchType, string> = {
  '5v5': '小场 5 人制',
  '7v7': '半场 7 人制（推荐）',
  '11v11': '标准 11 人制',
}

export const EVENT_TYPES: EventType[] = ['拿球', '传球', '射门', '突破', '拦截', '抢断']
