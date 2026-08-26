"use strict";

// Qwen 的输出是外部模型返回值，不能假定始终是干净的 JSON。
// 这里仅负责解析并补齐稳定契约；原始文本和模型新增字段都会保留。

const TEAM_STAT_KEYS = [
  "passes", "passes_success", "shots", "shots_on_target", "touches", "touches_success",
  "pass_errors", "passErrors", "turnovers", "dispossessed", "dribbles", "interceptions", "tackles", "goals", "assists"
];
const PLAYER_STAT_KEYS = [
  "touches", "touches_success", "turnovers", "dispossessed", "passes", "passes_success",
  "pass_errors", "passErrors", "shots", "shots_on_target", "dribbles", "interceptions", "tackles", "goals", "assists"
];

const emptyStats = (keys) => Object.fromEntries(keys.map((key) => [key, null]));
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asArray = (value) => Array.isArray(value) ? value : [];
const asNullableString = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const asNullableNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
function normalizeStats(value, keys) {
  const stats = { ...emptyStats(keys), ...asObject(value) };
  // 当前 Web 看板历史上同时出现过 snake_case 与 camelCase，统一补齐两种别名。
  if (stats.pass_errors == null && typeof stats.passErrors === "number") stats.pass_errors = stats.passErrors;
  if (stats.passErrors == null && typeof stats.pass_errors === "number") stats.passErrors = stats.pass_errors;
  return stats;
}

function normalizeTeam(value) {
  const team = asObject(value);
  const stats = asObject(team.stats);
  return {
    ...team,
    id: asNullableString(team.id),
    name: asNullableString(team.name),
    score: asNullableNumber(team.score),
    possession_pct: asNullableNumber(team.possession_pct),
    shots: asNullableNumber(team.shots),
    shots_on_target: asNullableNumber(team.shots_on_target),
    average_score: asNullableNumber(team.average_score),
    stats: normalizeStats(stats, TEAM_STAT_KEYS),
    highlights: asArray(team.highlights),
    weaknesses: asArray(team.weaknesses),
    next_focus: asArray(team.next_focus)
  };
}

function normalizePlayer(value) {
  const player = asObject(value);
  const stats = asObject(player.stats);
  return {
    ...player,
    id: asNullableString(player.id),
    number: asNullableString(player.number),
    name: asNullableString(player.name),
    position: asNullableString(player.position),
    score: asNullableNumber(player.score),
    stats: normalizeStats(stats, PLAYER_STAT_KEYS),
    insights: asArray(player.insights),
    events: asArray(player.events),
    title: asNullableString(player.title),
    highlight: player.highlight && typeof player.highlight === "object" ? { ...player.highlight } : null,
    source: asNullableString(player.source) || "qwen-vlm"
  };
}

function normalizeEvent(value) {
  const event = asObject(value);
  return {
    ...event,
    time_seconds: asNullableNumber(event.time_seconds),
    type: asNullableString(event.type),
    team: asNullableString(event.team),
    player_id: asNullableString(event.player_id),
    player_number: asNullableString(event.player_number),
    outcome: asNullableString(event.outcome),
    note: asNullableString(event.note),
    source: asNullableString(event.source) || "qwen-vlm"
  };
}

function eventKind(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/goal|进球/.test(raw)) return "goal";
  if (/pass|传球/.test(raw)) return "pass";
  if (/shot|射门/.test(raw)) return "shot";
  if (/touch|拿球|触球/.test(raw)) return "touch";
  if (/interception|拦截/.test(raw)) return "interception";
  if (/tackle|抢断/.test(raw)) return "tackle";
  if (/turnover|失误/.test(raw)) return "turnover";
  if (/dispossessed|被断/.test(raw)) return "dispossessed";
  return null;
}

function eventTeam(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^(home|我方|主队)$/.test(raw)) return "home";
  if (/^(away|对方|客队)$/.test(raw)) return "away";
  return null;
}

function eventSucceeded(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/failed|fail|失误|失败|被断/.test(raw)) return false;
  if (/success|successful|成功|完成|进球|射正/.test(raw)) return true;
  return null;
}

/** 用模型已列出的事件补足空统计，绝不从自然语言猜数字。 */
function deriveStatsFromEvents(dashboard) {
  const events = dashboard.events || [];
  const byTeam = { home: {}, away: {} };
  for (const event of events) {
    const team = eventTeam(event.team);
    const kind = eventKind(event.type);
    if (!team || !kind) continue;
    const stats = byTeam[team];
    stats[kind] = (stats[kind] || 0) + 1;
    if (kind === "pass") {
      const success = eventSucceeded(event.outcome);
      if (success === true) stats.passes_success = (stats.passes_success || 0) + 1;
      if (success === false) stats.pass_errors = (stats.pass_errors || 0) + 1;
    }
    if (kind === "shot" && eventSucceeded(event.outcome) === true) stats.shots_on_target = (stats.shots_on_target || 0) + 1;
  }
  for (const key of ["home", "away"]) {
    const team = dashboard.teams[key];
    const derived = byTeam[key];
    const map = { pass: "passes", shot: "shots", touch: "touches", interception: "interceptions", tackle: "tackles", turnover: "turnovers", dispossessed: "dispossessed", goal: "goals" };
    for (const [eventKey, statKey] of Object.entries(map)) if (team.stats[statKey] == null && derived[eventKey]) team.stats[statKey] = derived[eventKey];
    for (const keyName of ["passes_success", "pass_errors", "shots_on_target"]) if (team.stats[keyName] == null && derived[keyName]) team.stats[keyName] = derived[keyName];
    if (team.shots == null && team.stats.shots != null) team.shots = team.stats.shots;
    if (team.score == null && team.stats.goals != null) team.score = team.stats.goals;
  }
  // score 只接受与明确 goal 事件一致的值；没有 goal 事件不能凭空展示比分。
  const goals = { home: byTeam.home.goal || 0, away: byTeam.away.goal || 0 };
  const hasGoal = goals.home + goals.away > 0;
  if (!hasGoal) {
    dashboard.match.score.home = null;
    dashboard.match.score.away = null;
  } else {
    for (const key of ["home", "away"]) {
      if (dashboard.match.score[key] == null) dashboard.match.score[key] = goals[key];
    }
  }
  if (!dashboard.notes.includes("团队数字仅由已列出的视觉事件汇总")) dashboard.notes.push("团队数字仅由已列出的视觉事件汇总");
  return dashboard;
}

function normalizeDashboard(value) {
  const input = asObject(value);
  const match = asObject(input.match);
  const score = asObject(match.score);
  const teams = asObject(input.teams);
  const summary = asObject(input.summary);
  return {
    ...input,
    schema_version: asNullableString(input.schema_version) || "1.0",
    source: asNullableString(input.source) || "qwen-vlm",
    data_status: asNullableString(input.data_status) || "model_estimate",
    notes: asArray(input.notes),
    match: {
      ...match,
      name: asNullableString(match.name),
      duration_seconds: asNullableNumber(match.duration_seconds),
      score: {
        ...score,
        home: asNullableNumber(score.home),
        away: asNullableNumber(score.away)
      }
    },
    teams: {
      ...teams,
      home: normalizeTeam(teams.home),
      away: normalizeTeam(teams.away)
    },
    summary: {
      ...summary,
      highlight: asNullableString(summary.highlight),
      weakness: asNullableString(summary.weakness),
      next_focus: asNullableString(summary.next_focus),
      headline: asNullableString(summary.headline)
    },
    players: asArray(input.players).map(normalizePlayer),
    events: asArray(input.events).map(normalizeEvent),
    source_frames: asArray(input.source_frames)
  };
}

function extractJson(text) {
  const source = String(text || "").trim();
  if (!source) return { status: "empty", value: null, error: "模型未返回内容" };
  const unfenced = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return { status: "parsed", value: JSON.parse(unfenced) }; } catch (_) { /* try embedded JSON */ }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return { status: "parsed", value: JSON.parse(unfenced.slice(start, end + 1)) }; }
    catch (error) { return { status: "invalid", value: null, error: error instanceof Error ? error.message : "JSON 解析失败" }; }
  }
  return { status: "invalid", value: null, error: "未找到 JSON 对象" };
}

function parseVlmText(rawContent) {
  const extracted = extractJson(rawContent);
  if (extracted.status !== "parsed") {
    return { parse_status: extracted.status, parse_error: extracted.error, structured: null };
  }
  const value = asObject(extracted.value);
  // 允许模型直接返回 dashboard，也允许包一层 { dashboard: ... }。
  const dashboard = deriveStatsFromEvents(normalizeDashboard(value.dashboard || value));
  return { parse_status: "parsed", parse_error: null, structured: dashboard };
}

module.exports = { parseVlmText, normalizeDashboard, extractJson, deriveStatsFromEvents };
