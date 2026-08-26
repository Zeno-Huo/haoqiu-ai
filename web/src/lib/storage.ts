// localStorage 持久化层：比赛记录、球员名单、分析报告，刷新不丢

import type { Match, PlayerAnalysis, TeamMember, TeamProfile } from '../types'
import { createRng } from './seed'

// v3：看板「亮点称号 + 位置维度」改版后数据模型变更（球员新增必填 position、分析新增 title/highlight），旧 v2 数据不再兼容，换 key 自动作废
// V1.4 新增 myScore/oppScore 为「向后兼容」的可选字段：旧 v3 数据无此字段，读取时补默认 0，无需换 key 作废
const MATCHES_KEY = 'haoqiu_ai_matches_v3'
const TEAM_KEY = 'haoqiu_ai_team_v1'

interface DemoComparison {
  opponentName: string
  possessionHome: number
  possessionAway: number
  shotsAway: number
}

/** 为旧记录生成稳定的演示对比数据；同一场比赛刷新后不变。 */
function demoComparison(m: Match): DemoComparison {
  const rng = createRng(`comparison:${m.id}`)
  const home = 46 + rng.int(0, 8)
  return {
    opponentName: '对手',
    possessionHome: home,
    possessionAway: 100 - home,
    shotsAway: Math.max(0, (m.oppScore ?? 0) + rng.int(1, 5)),
  }
}

/** 规范化旧数据：补齐比分和稳定的演示对比字段。 */
function normalizeMatch(m: Match): Match {
  const fallback = demoComparison(m)
  const home = typeof m.possessionHome === 'number' && Number.isFinite(m.possessionHome) ? Math.round(m.possessionHome) : fallback.possessionHome
  const away = typeof m.possessionAway === 'number' && Number.isFinite(m.possessionAway) ? Math.round(m.possessionAway) : 100 - home
  return {
    ...m,
    myScore: typeof m.myScore === 'number' && Number.isFinite(m.myScore) ? m.myScore : 0,
    oppScore: typeof m.oppScore === 'number' && Number.isFinite(m.oppScore) ? m.oppScore : 0,
    opponentName: m.opponentName?.trim() || fallback.opponentName,
    possessionHome: Math.min(100, Math.max(0, home)),
    possessionAway: Math.min(100, Math.max(0, away)),
    shotsAway: typeof m.shotsAway === 'number' && Number.isFinite(m.shotsAway) ? Math.max(0, Math.round(m.shotsAway)) : fallback.shotsAway,
    identificationStatus: m.identificationStatus ?? (m.analysis ? 'confirmed' : 'pending'),
    analysis: m.analysis?.map((item) => ({
      ...item,
      stats: {
        ...item.stats,
        dispossessed: typeof item.stats.dispossessed === 'number' ? item.stats.dispossessed : 0,
      },
    })),
  }
}

function fallbackTeam(): TeamProfile {
  const latest = readMatches().sort((a, b) => b.createdAt - a.createdAt)[0]
  const members: TeamMember[] = (latest?.players ?? []).map((player) => ({
    id: `tm_${player.id}`,
    name: player.name,
    commonNumber: player.number,
    preferredPosition: player.position,
    createdAt: latest?.createdAt ?? Date.now(),
  }))
  return {
    id: 'team_primary',
    name: latest?.teamName || '我的球队',
    members,
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
    matches[idx] = normalizeMatch(match)
  } else {
    matches.push(normalizeMatch(match))
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
