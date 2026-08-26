import assert from "node:assert/strict";
import test from "node:test";
// JS 模块同时被 CloudBase 云函数直接加载；契约测试从源码加载，避免复制解析逻辑。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseVlmText } = require(`${process.cwd()}/haoqiu-vlm/vlm-schema.js`) as {
  parseVlmText: (rawContent: string) => { parse_status: string; parse_error?: string; structured: any }
};

test("VLM JSON is normalized to the dashboard contract and preserves model fields", () => {
  const result = parseVlmText(`\n\`\`\`json\n${JSON.stringify({
    summary: { headline: "边路推进较突出" },
    teams: { home: { name: "蓝队", possession_pct: 54, stats: { passes: 8, passErrors: 2, custom_metric: "保留" } } },
    players: [{ number: "9", score: 8.7, stats: { shots: 2 } }],
    events: [{ time_seconds: 12.5, type: "射门", extra: "保留" }],
    custom_top_level: true
  })}\n\`\`\``);
  assert.equal(result.parse_status, "parsed");
  assert.equal(result.structured.summary.headline, "边路推进较突出");
  assert.equal(result.structured.teams.home.possession_pct, 54);
  assert.equal(result.structured.teams.home.stats.passes, 8);
  assert.equal(result.structured.teams.home.stats.pass_errors, 2);
  assert.equal(result.structured.teams.home.stats.passErrors, 2);
  assert.equal(result.structured.teams.home.stats.shots, null);
  assert.equal(result.structured.teams.home.stats.custom_metric, "保留");
  assert.equal(result.structured.players[0].stats.shots, 2);
  assert.equal(result.structured.players[0].stats.passes, null);
  assert.equal(result.structured.events[0].extra, "保留");
  assert.equal(result.structured.custom_top_level, true);
});

test("invalid or empty VLM text remains raw and has no fake structured result", () => {
  assert.deepEqual(parseVlmText("模型暂时无法判断"), { parse_status: "invalid", parse_error: "未找到 JSON 对象", structured: null });
  assert.equal(parseVlmText("").parse_status, "empty");
  assert.equal(parseVlmText("").structured, null);
});

test("event log derives only witnessed counts and rejects unsupported score", () => {
  const withoutGoals = parseVlmText(JSON.stringify({
    match: { score: { home: 1, away: 2 } },
    events: [{ time_seconds: 5, type: "传球", team: "我方", outcome: "成功" }]
  }));
  assert.equal(withoutGoals.structured.match.score.home, null);
  assert.equal(withoutGoals.structured.match.score.away, null);
  assert.equal(withoutGoals.structured.teams.home.stats.passes, 1);
  assert.equal(withoutGoals.structured.teams.home.stats.passes_success, 1);

  const withGoal = parseVlmText(JSON.stringify({
    events: [{ time_seconds: 8, type: "goal", team: "home", outcome: "成功" }, { time_seconds: 10, type: "shot", team: "home", outcome: "成功" }]
  }));
  assert.equal(withGoal.structured.match.score.home, 1);
  assert.equal(withGoal.structured.match.score.away, 0);
  assert.equal(withGoal.structured.teams.home.stats.goals, 1);
  assert.equal(withGoal.structured.teams.home.stats.shots, 1);
  assert.equal(withGoal.structured.teams.home.stats.shots_on_target, 1);
});
