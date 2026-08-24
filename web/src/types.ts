// 好球Ai · MVP 阶段一 数据类型定义
import type { DetectionJob } from './detectionTypes'
import type { CloudDetectionJob } from './cloudDetectionTypes'

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

/** 球队成员档案：号码与位置均为偏好信息，不作为永久身份凭证。 */
export interface TeamMember {
  id: string
  name: string
  nickname?: string
  commonNumber?: string
  preferredPosition: Position
  createdAt: number
}

/** MVP 先支持队长维护一支自己的球队。 */
export interface TeamProfile {
  id: string
  name: string
  members: TeamMember[]
  updatedAt: number
}

export type IdentificationStatus = 'pending' | 'confirmed' | 'skipped'

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
  /** 对手名称与对比数据：当前均为本地确定性演示数据 */
  opponentName?: string
  possessionHome?: number
  possessionAway?: number
  shotsAway?: number
  teamId?: string
  videoName?: string
  videoSource?: 'local-file' | 'demo'
  /** 浏览器本地读取的文件信息；文件本身不写入持久存储。 */
  videoMeta?: {
    sizeBytes: number
    durationSeconds?: number
    width?: number
    height?: number
  }
  identificationStatus?: IdentificationStatus
  /** 画面候选球员 ID -> 球队成员 ID。只有出现在此表中的身份才视为已由队长确认。 */
  playerIdentityMap?: Record<string, string>
  /** 真实检测任务可刷新恢复；与本地球队复盘 Demo 分开。 */
  detectionJobId?: string
  detectionJob?: DetectionJob
  /** COS 整段视频已上传后才持久化 upload_id；不保存任何签名 URL。 */
  cloudUploadId?: string
  cloudJobId?: string
  cloudDetectionJob?: CloudDetectionJob
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

/** 球员客观数据统计，全部由可观察事件聚合或派生。 */
export interface PlayerStats {
  touches: number // 拿球次数（接球/触球总次数）
  touchesSuccess: number // 拿球成功次数
  turnovers: number // 其他失误（不含传球失误与被断球）
  dispossessed: number // 持球时被对手断球
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
export type EventType = '拿球' | '传球' | '射门' | '突破' | '拦截' | '抢断' | '被断'

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

export const EVENT_TYPES: EventType[] = ['拿球', '传球', '射门', '突破', '拦截', '抢断', '被断']
