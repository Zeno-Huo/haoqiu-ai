"use strict";

// 即时分析(VLM)云函数：由 haoqiu-api 通过 callFunction 异步触发。
// 流程：从 COS 读取任务 JSON(db/task/<id>.json) → 生成视频签名地址 →
// 调用通义千问 qwen-vl-plus 视频理解 API → 把文字事件总结写回同一 COS JSON。
//
// 注意：体验版 CloudBase 无文档型数据库，任务存储统一走 COS JSON，
// 与 haoqiu-api 的 CosRepository(键路径 db/task/<id>.json) 保持一致。

const COS = require("cos-nodejs-sdk-v5");
const { parseVlmText } = require("./vlm-schema");

const envId = process.env.CLOUDBASE_ENV_ID || "haoqiu-ai-prod-d3g2cm2xn3255c273";
const bucket = process.env.COS_BUCKET || "haoqiu-ai-media-1352817304";
const region = process.env.COS_REGION || "ap-shanghai";
const vlmProvider = process.env.VLM_PROVIDER || "qwen";
const vlmApiKey = process.env.VLM_API_KEY || process.env.DASHSCOPE_API_KEY;
const vlmModel = process.env.VLM_MODEL || "qwen-vl-plus";

const TASK_PREFIX = "db/task/";
const taskKey = (id) => `${TASK_PREFIX}${id}.json`;

let cosInstance;
function getCos() {
  if (!cosInstance) {
    const SecretId = process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID;
    const SecretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY;
    const SecurityToken = process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENT_SESSION_TOKEN;
    cosInstance = new COS({ SecretId, SecretKey, SecurityToken });
  }
  return cosInstance;
}

function signedGetUrl(key, expires) {
  return new Promise((resolve, reject) => {
    getCos().getObjectUrl(
      { Bucket: bucket, Region: region, Key: key, Method: "GET", Sign: true, Expires: expires },
      (error, data) => (error ? reject(error) : resolve(data.Url))
    );
  });
}

// 直接读 COS 对象为 JSON（与 CosRepository.getJson 等价，但此处是独立函数避免引入 TS 依赖）。
function getJson(key) {
  return new Promise((resolve, reject) => {
    getCos().getObject({ Bucket: bucket, Region: region, Key: key }, (error, data) => {
      if (error) {
        const status = Number(error.statusCode || 0);
        if (status === 404 || error.code === "NoSuchKey") return resolve(null);
        return reject(error);
      }
      const body = data && data.Body;
      if (!body) return resolve(null);
      try {
        const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function putJson(key, value) {
  return new Promise((resolve, reject) => {
    getCos().putObject(
      { Bucket: bucket, Region: region, Key: key, Body: JSON.stringify(value), ContentType: "application/json" },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

async function getTask(taskId) {
  return getJson(taskKey(taskId));
}

// 读-改-写整个任务对象，保留 haoqiu-api 已写入的全部字段，只合并本次 patch。
async function updateTask(taskId, patch) {
  const current = await getTask(taskId);
  if (!current) throw new Error("task not found: " + taskId);
  const updated = { ...current, ...patch };
  await putJson(taskKey(taskId), updated);
  return updated;
}

const VLM_PROMPT = `你是一名足球比赛视频事件标注员。请完整观看这一段视频，为球队复盘看板输出严格的 JSON，不要输出 Markdown、代码围栏、解释或寒暄。
这是一个短视频片段，不是完整比赛。你只能陈述此片段中亲眼看见的事实：禁止把片段称作“上半场/下半场”，禁止根据常识、队名、球衣或前后文补全整场比分、球员姓名、战术结论或比赛故事。
先在 events 中逐条列出可验证事件，再由这些 events 汇总团队与球员数字。无法从画面判断的字段必须使用 null，数组没有内容时使用 []。不要为了填满看板猜测数字。

严格取数规则：
1. 进球：仅当清楚看到球整体越过球门线，或进球后能看到明确的裁判/开球重启证据时，才记录 type="goal"。每一个 goal 必须有对应 events 条目。
2. 传球：仅当看见球从一名队员被踢/抛出并被另一名队员接到，记录 type="pass"；传出后被对手截获或直接出界，记录 outcome="failed"。看不清起止双方时不要猜传球。
3. 射门：仅当明显以球门为目标的踢球时记录 type="shot"；只有球进入球门或被门将/门框明确挡住才判断 shots_on_target。
4. score 只统计这个视频片段中确认的 goal 数，不是整场比分；没有确认进球时 home=0、away=0；一方不明时该方为 null。若视频画面有比分牌但无法确认其对应关系，score 使用 null。
5. 控球率、球员评分、球队平均分：除非视频覆盖足够长且画面连续，默认 null。20 秒左右片段不得臆测控球率或评分。
6. 球员姓名：只有画面中清晰可读才填写；不能从球衣颜色或号码推名字。每个 event 应提供 time_seconds（可约数）及 note（描述看见了什么）。

所有结果都是视觉模型判断，顶层 source 固定为 "qwen-vlm"，data_status 固定为 "model_estimate"，notes 至少包含 "字段由视觉模型根据视频推断"。

输出结构（数字必须是 number，不要带单位）：
{
  "schema_version":"1.0", "source":"qwen-vlm", "data_status":"model_estimate", "notes":[],
  "match":{"name":null,"duration_seconds":null,"score":{"home":null,"away":null}},
  "teams":{
    "home":{"id":null,"name":null,"score":null,"possession_pct":null,"shots":null,"shots_on_target":null,"average_score":null,"stats":{"passes":null,"passes_success":null,"pass_errors":null,"shots":null,"shots_on_target":null,"touches":null,"touches_success":null,"turnovers":null,"dispossessed":null,"dribbles":null,"interceptions":null,"tackles":null,"goals":null,"assists":null},"highlights":[],"weaknesses":[],"next_focus":[]},
    "away":{"id":null,"name":null,"score":null,"possession_pct":null,"shots":null,"shots_on_target":null,"average_score":null,"stats":{"passes":null,"passes_success":null,"pass_errors":null,"shots":null,"shots_on_target":null,"touches":null,"touches_success":null,"turnovers":null,"dispossessed":null,"dribbles":null,"interceptions":null,"tackles":null,"goals":null,"assists":null},"highlights":[],"weaknesses":[],"next_focus":[]}
  },
  "summary":{"headline":null,"highlight":null,"weakness":null,"next_focus":null},
  "players":[{"id":null,"number":null,"name":null,"position":null,"score":null,"stats":{"touches":null,"touches_success":null,"turnovers":null,"dispossessed":null,"passes":null,"passes_success":null,"pass_errors":null,"shots":null,"shots_on_target":null,"dribbles":null,"interceptions":null,"tackles":null,"goals":null,"assists":null},"insights":[],"events":[],"title":null,"highlight":null,"source":"qwen-vlm"}],
  "events":[{"time_seconds":null,"type":null,"team":null,"player_id":null,"player_number":null,"outcome":null,"note":null,"source":"qwen-vlm"}],
  "source_frames":[]
}
球员看不清姓名时 name 使用 null；能看到号码就填写 number。只呈现观察到的事件和数据，不给换人、换位等强制决定。`;

function analysisContextPrompt(context) {
  if (!context || typeof context !== "object") return "本场我方没有队长标记；team 只有在画面可明确区分时才填写 home/away，否则使用 null。";
  const lines = ["队长已提供本场我方视觉线索："];
  if (typeof context.team_name === "string" && context.team_name.trim()) lines.push(`- 看板中 home 可命名为：${context.team_name.trim()}`);
  if (typeof context.jersey_hint === "string" && context.jersey_hint.trim()) lines.push(`- 我方球衣补充：${context.jersey_hint.trim()}`);
  const point = context.opening_frame_point;
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) lines.push(`- 视频开头帧中，画面横向 ${Math.round(point.x * 100)}%、纵向 ${Math.round(point.y * 100)}% 附近被队长标记的球员属于我方。以该球员的同队球衣特征区分我方与对方。`);
  lines.push("此线索只适用于本次视频；看不清或无法把同队特征延续到事件时，team 使用 null，不能猜。" );
  return lines.join("\n");
}

async function callQwenVL(videoUrl, analysisContext) {
  const body = {
    model: vlmModel,
    input: {
      messages: [
        { role: "user", content: [{ video: videoUrl }, { text: `${VLM_PROMPT}\n\n${analysisContextPrompt(analysisContext)}` }] }
      ]
    },
    parameters: { result_format: "message" }
  };
  const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${vlmApiKey}` },
    body: JSON.stringify(body)
  });
  const json = await resp.json();
  const content = json && json.output && json.output.choices && json.output.choices[0] && json.output.choices[0].message && json.output.choices[0].message.content;
  let text = "";
  if (Array.isArray(content)) text = content.map((c) => (c && c.text) || "").join("");
  else if (typeof content === "string") text = content;
  if (!text) throw new Error("VLM 未返回文字内容: " + JSON.stringify(json).slice(0, 500));
  return text;
}

function mockSummary(task) {
  const dur = task && task.input && task.input.duration_seconds ? Math.round(task.input.duration_seconds) : 0;
  return `【即时分析 · 演示模式】\n尚未配置视觉大模型 API Key，以下为示例结构（非真实分析）：\n· 关键事件：示例——第 12 分钟一次威胁进攻、第 23 分钟后防一次失误。\n· 态势：中段我方控球占优，末段节奏下降。\n· 即时建议：示例——后腰补防、加快攻防转换。\n（视频时长约 ${dur} 秒。配置 VLM_API_KEY 后将输出真实视频理解结果。）`;
}

exports.main = async (event) => {
  const data =
    typeof event === "string"
      ? JSON.parse(event)
      : event && event.body
        ? typeof event.body === "string"
          ? JSON.parse(event.body)
          : event.body
        : event;
  const taskId = data && (data.taskId || data.task_id);
  if (!taskId) return { ok: false, error: "missing taskId" };
  try {
    const task = await getTask(taskId);
    if (!task) return { ok: false, error: "task not found: " + taskId };
    if ((task.status === "succeeded" && task.text_result) || task.status === "running") {
      return { ok: true, skipped: true, reason: task.status };
    }

    await updateTask(taskId, { status: "running", stage: "analyzing", progress: 15, started_at: new Date().toISOString() });

    let text;
    if (!vlmApiKey) {
      text = mockSummary(task);
    } else {
      const videoUrl = await signedGetUrl(task.input_object_key, 3600);
      text = await callQwenVL(videoUrl, task.analysis_context);
    }

    const parsed = parseVlmText(text);
    await updateTask(taskId, {
      status: "succeeded",
      stage: "completed",
      progress: 100,
      text_result: {
        content: text,
        raw_content: text,
        model: vlmApiKey ? `${vlmProvider}:${vlmModel}` : "demo",
        generated_at: new Date().toISOString(),
        parse_status: parsed.parse_status,
        parse_error: parsed.parse_error,
        structured: parsed.structured
      },
      completed_at: new Date().toISOString()
    });
    return { ok: true, taskId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await updateTask(taskId, { status: "failed", stage: "failed", error: { code: "VLM_FAILED", message } });
    } catch (_) {
      /* ignore secondary failure */
    }
    return { ok: false, error: message };
  }
};
