// localStorage 持久化层：比赛记录、球员名单、分析报告，刷新不丢

import type { Match, PlayerAnalysis } from '../types'

// v3：看板「亮点称号 + 位置维度」改版后数据模型变更（球员新增必填 position、分析新增 title/highlight），旧 v2 数据不再兼容，换 key 自动作废
// V1.4 新增 myScore/oppScore 为「向后兼容」的可选字段：旧 v3 数据无此字段，读取时补默认 0，无需换 key 作废
const MATCHES_KEY = 'haoqiu_ai_matches_v3'

/** 规范化旧数据：缺比分字段时补 0，保证下游可直接用 match.myScore / oppScore */
function normalizeMatch(m: Match): Match {
  return {
    ...m,
    myScore: typeof m.myScore === 'number' && Number.isFinite(m.myScore) ? m.myScore : 0,
    oppScore: typeof m.oppScore === 'number' && Number.isFinite(m.oppScore) ? m.oppScore : 0,
  }
}

function readMatches(): Match[] {
  try {
    const raw = localStorage.getItem(MATCHES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as Match[]).map(normalizeMatch)
  } catch {
    return []
  }
}

function writeMatches(matches: Match[]): void {
  try {
    localStorage.setItem(MATCHES_KEY, JSON.stringify(matches))
  } catch {
    // 存储已满或被禁用时静默降级，不影响当前会话
  }
}

export function listMatches(): Match[] {
  return readMatches().sort((a, b) => b.createdAt - a.createdAt)
}

export function getMatch(id: string): Match | undefined {
  return readMatches().find((m) => m.id === id)
}

export function saveMatch(match: Match): void {
  const matches = readMatches()
  const idx = matches.findIndex((m) => m.id === match.id)
  if (idx >= 0) {
    matches[idx] = match
  } else {
    matches.push(match)
  }
  writeMatches(matches)
}

export function deleteMatch(id: string): void {
  writeMatches(readMatches().filter((m) => m.id !== id))
}

/** 保存分析结果到对应比赛 */
export function saveAnalysis(matchId: string, analysis: PlayerAnalysis[]): Match | undefined {
  const matches = readMatches()
  const match = matches.find((m) => m.id === matchId)
  if (!match) return undefined
  match.analysis = analysis
  writeMatches(matches)
  return match
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
