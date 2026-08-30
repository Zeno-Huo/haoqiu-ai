import type { Match } from '../types'

/**
 * 按比赛实际产生的结果分流到对应页面。
 *
 * 历史上这里只判断 match.analysis，导致即时分析（结果在云端 instantJobId）
 * 被误判成"未分析"而弹去 analyzing，永远看不到复盘。三种来源必须分开判断：
 * - instantJobId 存在 → 云端即时分析，复盘页 /match/:id/instant
 * - analysis 存在     → 本地演示复盘报告 /match/:id
 * - 都没有           → 还没分析过 /match/:id/analyzing
 */
export function matchTarget(match: Match): string {
  if (match.analysisMode === 'single') return `/match/${match.id}/tracking`
  if (match.analysisMode === 'training') return `/match/${match.id}/training`
  if (match.instantJobId) return `/match/${match.id}/instant`
  if (match.analysis) return `/match/${match.id}`
  return `/match/${match.id}/analyzing`
}

export type MatchKind = 'instant' | 'personal' | 'training' | 'report' | 'pending'

export function matchKind(match: Match): MatchKind {
  if (match.analysisMode === 'single') return 'personal'
  if (match.analysisMode === 'training') return 'training'
  if (match.instantJobId) return 'instant'
  if (match.analysis) return 'report'
  return 'pending'
}

export type MatchStatus = 'done' | 'running' | 'failed' | 'idle'

export function matchStatus(match: Match): MatchStatus {
  const job = match.instantAnalysisJob
  if (job?.status === 'succeeded') return 'done'
  if (job?.status === 'failed') return 'failed'
  if (job?.status) return 'running'
  if (match.analysis) return 'done'
  return 'idle'
}

export const MATCH_KIND_LABEL: Record<MatchKind, string> = {
  instant: '即时分析',
  personal: '个人比赛',
  training: '个人训练',
  report: '演示往期分析',
  pending: '待分析',
}

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  done: '分析完成',
  running: '正在分析',
  failed: '分析失败',
  idle: '尚未分析',
}
