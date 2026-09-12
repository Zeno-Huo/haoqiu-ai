// 会话内记录层：比赛记录只存在于当前页面会话，刷新即清空，不做本地持久化。
//
// 2026-09-12 变更：移除 localStorage 中的比赛记录（含历史视频与过往分析）。
// 现在的语义是「只保留当前这一次」，single-slot、覆盖式：
//   - 上传 → 分析 → 看报告，全程在当前会话内完成；
//   - 刷新或直接打开报告链接 → 记录不存在，页面引导重新上传。
// 球队档案（TEAM_KEY）不属于历史记录，仍按用户设置持久化保存。

import type { Match, TeamProfile } from '../types'

const TEAM_KEY = 'haoqiu_ai_team_v1'

/** 当前这一次分析的记录；刷新页面即丢失。 */
let currentMatch: Match | undefined

/**
 * 只做类型与取值兜底：缺字段时保持缺省，**绝不生成任何演示/随机数值**。
 * 数据缺失应由界面显示「未识别 / —」，而不是编一个看起来像真的数。
 */
function normalizeMatch(m: Match): Match {
  return {
    ...m,
    myScore: typeof m.myScore === 'number' && Number.isFinite(m.myScore) ? m.myScore : 0,
    oppScore: typeof m.oppScore === 'number' && Number.isFinite(m.oppScore) ? m.oppScore : 0,
    opponentName: m.opponentName?.trim() || '对手',
    identificationStatus: m.identificationStatus ?? 'pending',
  }
}

function fallbackTeam(): TeamProfile {
  return {
    id: 'team_primary',
    name: '我的球队',
    members: [],
    updatedAt: Date.now(),
  }
}

export function getTeamProfile(): TeamProfile {
  try {
    const raw = localStorage.getItem(TEAM_KEY)
    if (!raw) return fallbackTeam()
    const parsed = JSON.parse(raw) as TeamProfile
    if (!parsed || !Array.isArray(parsed.members)) return fallbackTeam()
    return parsed
  } catch {
    return fallbackTeam()
  }
}

export function saveTeamProfile(team: TeamProfile): void {
  try {
    localStorage.setItem(TEAM_KEY, JSON.stringify({ ...team, updatedAt: Date.now() }))
  } catch {
    // 存储不可用时保持当前页面可操作。
  }
}

/** 保存/更新当前这一次的记录（覆盖式，不累积历史）。 */
export function saveMatch(match: Match): void {
  currentMatch = normalizeMatch(match)
}

/** 读取当前这一次的记录；id 不匹配或页面已刷新则返回 undefined。 */
export function getMatch(id: string): Match | undefined {
  return currentMatch?.id === id ? currentMatch : undefined
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
