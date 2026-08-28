"use strict";

// 即时分析(VLM)云函数：多轮整视频直传（2026-08-28 回退版 / 第六版）
//
// 核心思路：
// 1. 不给模型抽帧、不下载视频，每轮把【完整视频 URL + 针对性 prompt】发给 qwen-vl-max
// 2. 共 5 轮，每轮只让模型专注一件事：
//     ① 球员识别（号码/角色/2-3条具体评语/标签/MVP，不再输出位置——实测位置会认错）
//     ③ 传球统计
//     ④ 射门识别（最严格）
//     ⑤ 防守事件（抢断/拦截/被断/失误）
//     ⑥ 综合总结（headline/highlight/weakness/next_focus + 比分）
// 3. 每轮失败只记日志、不中断整体流程
// 4. 最后把 5 轮 JSON 合并成一个符合 dashboard 契约的结果
//
// 为什么回退到这一版：
// - 密集抽帧（ffmpeg 下载视频）在云端 fetch 的 Response.body 无 .pipe()，抽帧链路失败
// - 整视频直传让千问自己处理视频，规避了抽帧/下载环节

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const COS = require("cos-nodejs-sdk-v5");

const execFileAsync = promisify(execFile);

const { parseVlmText } = require("./vlm-schema");

const envId = process.env.CLOUDBASE_ENV_ID || "haoqiu-ai-prod-d3g2cm2xn3255c273";
const bucket = process.env.COS_BUCKET || "haoqiu-ai-media-1352817304";
const region = process.env.COS_REGION || "ap-shanghai";
const vlmProvider = process.env.VLM_PROVIDER || "qwen";
const vlmApiKey = process.env.VLM_API_KEY || process.env.DASHSCOPE_API_KEY;
const vlmModel = process.env.VLM_MODEL || "qwen-vl-max";

const TASK_PREFIX = "db/task/";
const taskKey = (id) => `${TASK_PREFIX}${id}.json`;

// ============================================================
// COS 工具函数
// ============================================================

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
      } catch (e) { reject(e); }
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

async function getTask(taskId) { return getJson(taskKey(taskId)); }

async function updateTask(taskId, patch) {
  const current = await getJson(taskKey(taskId));
  if (!current) throw new Error("task not found: " + taskId);
  const updated = { ...current, ...patch };
  await putJson(taskKey(taskId), updated);
  return updated;
}

// ============================================================
// 千问 VLM 调用（整视频直传）
// ============================================================

async function postToQwen(body) {
  const resp = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${vlmApiKey}` },
      body: JSON.stringify(body),
    }
  );
  const json = await resp.json();
  if (json.code && json.code !== "OK") {
    throw new Error(`千问API错误: ${json.code} - ${json.message || ""}`);
  }
  const content = json?.output?.choices?.[0]?.message?.content;
  let text = "";
  if (Array.isArray(content)) text = content.map((c) => c?.text || "").join("");
  else if (typeof content === "string") text = content;
  if (!text) throw new Error("VLM 未返回内容: " + JSON.stringify(json).slice(0, 500));
  return text;
}

async function callQwenWithVideo(videoUrl, promptText) {
  const body = {
    model: vlmModel,
    input: {
      messages: [{ role: "user", content: [{ video: videoUrl }, { text: promptText }] }],
    },
    parameters: { result_format: "message" },
  };
  return postToQwen(body);
}

// ============================================================
// 视频预处理：自动压制到千问可接受范围
// ============================================================
// 千问 qwen-vl-max 硬限制：≤150MB、≤10 分钟，单帧被缩放到 ~1024×640。
// 手机原片常达 500MB~1GB（4K），直接传会失败，所以在这里自动压制。
// 关键技巧：ffmpeg 直接从 COS 签名 URL 流式读取，原片不落盘，磁盘只占输出大小。

const VLM_MAX_BYTES = 120 * 1024 * 1024; // 目标输出大小（千问硬限 150MB，留余量也省它处理时间）
const VLM_MAX_SECONDS = 300; // 目标 5 分钟：既是产品建议时长，也让 5 轮 VLM + 压缩能塞进 900s 超时
const AUDIO_KBPS = 96;

// 注意：ffmpeg-static 的二进制是 postinstall 才下载的，云端装依赖时经常下不到（ENOENT）。
// @ffmpeg-installer/ffmpeg 把二进制直接打进 npm 包，云端按平台装 linux-x64，更可靠。
function resolveFfmpeg() {
  const candidates = [];
  try { candidates.push(require("@ffmpeg-installer/ffmpeg").path); } catch (e) { /* 未安装 */ }
  try { candidates.push(require("ffmpeg-static")); } catch (e) { /* 未安装 */ }
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (e) { /* path 非法 */ }
  }
  return null;
}

async function runSelfTest() {
  const out = { node: process.version, platform: process.platform, arch: process.arch, tmpdir: os.tmpdir() };
  try { out.tmpDisk = (await execFileAsync("sh", ["-c", `df -h ${os.tmpdir()} | tail -1`], { timeout: 10000 })).stdout.trim(); } catch (e) { out.tmpDiskErr = e.message; }
  try { out.systemFfmpeg = (await execFileAsync("sh", ["-c", "command -v ffmpeg || echo NOT_FOUND"], { timeout: 10000 })).stdout.trim(); } catch (e) { out.systemFfmpegErr = e.message; }
  const ffmpegPath = resolveFfmpeg();
  out.ffmpegStaticPath = ffmpegPath || null;
  if (!ffmpegPath) return out;
  try { out.version = (await execFileAsync(ffmpegPath, ["-version"], { timeout: 20000 })).stdout.split("\n")[0]; } catch (e) { out.versionErr = e.message; return out; }
  const tmp = path.join(os.tmpdir(), `selftest_${Date.now()}.mp4`);
  const started = Date.now();
  try {
    await execFileAsync(ffmpegPath, ["-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=1280x720:rate=30", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "3000k", "-pix_fmt", "yuv420p", tmp], { timeout: 120000 });
    out.encodeTest = { ok: true, bytes: fs.statSync(tmp).size, ms: Date.now() - started };
    fs.unlinkSync(tmp);
  } catch (e) {
    out.encodeTest = { ok: false, error: String(e.message).slice(0, 300), ms: Date.now() - started };
  }
  return out;
}

function putFile(key, filePath) {
  return new Promise((resolve, reject) => {
    getCos().putObject({ Bucket: bucket, Region: region, Key: key, Body: fs.createReadStream(filePath) }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/**
 * 必要时把视频压制到千问可接受范围。失败一律降级为原片，不阻断分析。
 * @returns {Promise<{url:string, compressed:boolean, seconds:number, reason:string, bytes?:number}>}
 */
async function ensureVlmPlayable({ signedUrl, sizeBytes, durationSec, taskId, onStage }) {
  const rawSeconds = Number(durationSec) || 0;
  const seconds = Math.min(rawSeconds || VLM_MAX_SECONDS, VLM_MAX_SECONDS);
  const tooLong = rawSeconds > VLM_MAX_SECONDS;
  const tooBig = sizeBytes > VLM_MAX_BYTES;
  const base = { url: signedUrl, compressed: false, seconds, reason: "原片已在限制内，未压缩" };
  if (!tooBig && !tooLong) return base;
  const ffmpegPath = resolveFfmpeg();
  if (!ffmpegPath) return { ...base, seconds, reason: `ffmpeg 不可用，跳过压缩（原片 ${(sizeBytes / 1048576).toFixed(0)}MB / ${Math.round(rawSeconds)}秒，可能触发千问限制）` };

  let outPath;
  try {
    if (onStage) await onStage("compressing", tooLong ? "视频超过 5 分钟，正在截取并压缩前 5 分钟" : "视频过大，正在压缩到可分析大小");
    console.log(`[vlm] 开始压缩: ${(sizeBytes / 1048576).toFixed(1)}MB / ${Math.round(rawSeconds)}s -> 目标 ${(VLM_MAX_BYTES / 1048576).toFixed(0)}MB / ${seconds}s`);
    outPath = path.join(os.tmpdir(), `vlm_${taskId}.mp4`);
    let videoKbps = Math.floor((VLM_MAX_BYTES * 8) / Math.max(1, seconds) / 1000) - AUDIO_KBPS;
    videoKbps = Math.max(500, Math.min(videoKbps, 15000));
    const args = [
      "-y", "-i", signedUrl,
      "-t", String(seconds),
      "-vf", "scale=w='min(1280,iw)':h=-2",
      // ultrafast：云函数约 1 核 CPU，实测 ~1.2x 实时。码率给足（3Mbps+）可抵消 preset 的质量损失。
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.3)}k`, "-bufsize", `${videoKbps * 2}k`,
      "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2",
      "-movflags", "+faststart",
      outPath,
    ];
    const started = Date.now();
    await execFileAsync(ffmpegPath, args, { timeout: 420000, maxBuffer: 8 * 1024 * 1024 });
    const bytes = fs.statSync(outPath).size;
    console.log(`[vlm] 压缩完成: ${(bytes / 1048576).toFixed(1)}MB, 耗时 ${Math.round((Date.now() - started) / 1000)}s, 码率 ${videoKbps}k`);
    const key = `compressed/${taskId}.mp4`;
    await putFile(key, outPath);
    fs.unlinkSync(outPath);
    const url = await signedGetUrl(key, 7200);
    return {
      url, compressed: true, seconds, bytes,
      reason: tooLong
        ? `原片 ${(rawSeconds / 60).toFixed(1)} 分钟，已截取前 5 分钟并压缩至 ${(bytes / 1048576).toFixed(0)}MB`
        : `原片 ${(sizeBytes / 1048576).toFixed(0)}MB，已压缩至 ${(bytes / 1048576).toFixed(0)}MB`,
    };
  } catch (err) {
    console.error("[vlm] 压缩失败，降级使用原片:", err?.message);
    if (outPath) { try { fs.unlinkSync(outPath); } catch (e) { /* ignore */ } }
    return { ...base, seconds, reason: `压缩失败(${String(err?.message).slice(0, 80)})，已用原片` };
  }
}

// ============================================================
// 各轮 Prompt（精简、正面引导，避免废话）
// ============================================================

function buildContextString(ctx) {
  const lines = [];
  if (ctx?.team_name) lines.push(`我方队名：${ctx.team_name}`);
  if (ctx?.jersey_hint) lines.push(`我方球衣特征：${ctx.jersey_hint}`);
  if (ctx?.opening_frame_point) {
    const p = ctx.opening_frame_point;
    lines.push(`视频开头画面中，横向${Math.round(p.x * 100)}%、纵向${Math.round(p.y * 100)}%附近的球员属于我方`);
  }
  return lines.length ? "\n【额外线索】\n" + lines.join("\n") + "\n看不清时 team 写 null。" : "";
}

function buildPlayersPrompt(durationSec, ctx) {
  const ctxPart = buildContextString(ctx);
  return `你是足球视频分析员。请观看这段完整比赛视频（总时长约 ${Math.round(durationSec)} 秒）。

${ctxPart}

【任务】识别我方球员，并对每人写具体的表现点评。
只列出你确实看清球衣号码、且真的能说出他做了什么的球员。最多 6 人。

【输出】只输出JSON（不要其他文字）：
{
  "players": [
    {
      "number": "10",
      "team": "home",
      "role": "进攻尖刀",
      "notes": [
        "多次从右侧肋部前插接球，跑位比队友更主动",
        "背身接球后能护住球等队友上来，对抗不吃亏",
        "但最后一脚出球偏急，有两次直接传给了对方"
      ],
      "tags": ["跑位主动", "护球稳", "出球偏急"],
      "is_mvp": true
    }
  ]
}

【字段要求】
- number：球衣上清晰可辨的数字（字符串）。模糊、猜的都不要列。
- team：固定 "home"（我方）。
- role：4~6 字的角色概括，必须从你看到的实际表现推断，例如：组织核心 / 进攻尖刀 / 边路快马 / 后场清扫 / 全能中场 / 定位球点。
  ⚠️ 不要写"前锋""中场""后卫""门将"这类笼统位置，也不要猜位置。
- notes：2~3 条具体表现描述，每条 15~40 字。
  必须是你在画面里真实看到的动作：拿球位置、跑动方向、对抗结果、出球选择、防守回追等。
  ⚠️ 禁止空话：不许出现"表现不错""比较活跃""有一定贡献""值得肯定"这类没有信息量的句子。
  ⚠️ 每条都要能对应到画面里的具体动作。如果只能写出 1 条，就只写 1 条，不要凑数。
- tags：2~4 个 2~5 字关键词，从 notes 提炼（如"抢点积极""回防慢""一脚出球"）。
- is_mvp：所有球员中表现最突出的一人写 true，其余写 false。只能有一个 true。

如果视频里没有看清任何号码，players 返回空数组 []。`;
}

function buildPassPrompt(durationSec, ctx) {
  const ctxPart = buildContextString(ctx);
  return `你是足球视频分析员。请观看这段完整比赛视频（总时长约 ${Math.round(durationSec)} 秒）。

${ctxPart}

【任务】统计视频中所有【传球】事件。
传球定义：球从一个球员传给同队球员。success=队友接住；failed=被截断/出界。

⚠️ 严格区分：向前直塞找前锋=传球；边路传中=传球；但【射门】和【带球跑】不是传球，不要计入。

【输出】只输出JSON（不要其他文字）：
{
  "events": [
    {"time_seconds": 12.5, "clock": "23:41", "type": "pass", "team": "home", "player_number": "10", "outcome": "success", "note": "短传给队友"}
  ]
}
- time_seconds 必须在 0 ~ ${Math.round(durationSec)} 之间（这是【视频内】的秒数，不是比赛时间）
- clock：如果画面上有比赛计时器/记分牌/直播字幕条显示比赛时间，填你看到的时间文本（如 "23:41"）；看不到计时器就填 null，不要推算
- type 固定 "pass"
- player_number 看不清写 null
- 没有传球则 events 返回 []`;
}

function buildShotPrompt(durationSec, ctx) {
  const ctxPart = buildContextString(ctx);
  return `你是足球视频分析员。请观看这段完整比赛视频（总时长约 ${Math.round(durationSec)} 秒）。

${ctxPart}

【任务】识别视频中所有【射门】和【进球】。

⚠️ 射门最严格定义（必须同时满足）：
  ① 球明显朝对方球门飞行
  ② 有射门意图
  success=射正/进门/被门将扑出；failed=偏出/高出
  进球 type 用 "goal"，outcome 用 "success"

⚠️ 这些【不是】射门，不要误判：
  - 向前直塞找前锋 = 传球
  - 边路传中 = 传球
  - 大脚解围 = 不是射门
  - 带球跑 / 个人突破 = 不是射门
  宁漏判也不要把普通传球当成射门。

【输出】只输出JSON（不要其他文字）：
{
  "events": [
    {"time_seconds": 35.0, "clock": "24:03", "type": "shot", "team": "home", "player_number": "10", "outcome": "failed", "note": "禁区外远射偏出"}
  ]
}
- time_seconds 必须在 0 ~ ${Math.round(durationSec)} 之间（视频内秒数）
- clock：画面上有比赛计时器/记分牌就填看到的时间文本（如 "24:03"）；看不到填 null，不要推算
- type 用 "shot" 或 "goal"
- 没有射门/进球则 events 返回 []`;
}

function buildDefensePrompt(durationSec, ctx) {
  const ctxPart = buildContextString(ctx);
  return `你是足球视频分析员。请观看这段完整比赛视频（总时长约 ${Math.round(durationSec)} 秒）。

${ctxPart}

【任务】识别视频中所有【防守相关】事件。

事件类型：
- tackle（抢断）：主动上抢断下对方球
- interception（拦截）：截获对方传球
- dispossessed（被断）：我方带球时被对方断走
- turnover（失误）：我方传球/控球失误丢球

【输出】只输出JSON（不要其他文字）：
{
  "events": [
    {"time_seconds": 22.0, "clock": "23:50", "type": "tackle", "team": "home", "player_number": "4", "outcome": "success", "note": "中场逼抢断球"}
  ]
}
- time_seconds 必须在 0 ~ ${Math.round(durationSec)} 之间（视频内秒数）
- clock：画面上有比赛计时器/记分牌就填看到的时间文本；看不到填 null，不要推算
- 没有防守事件则 events 返回 []`;
}

function buildSummaryPrompt(durationSec, ctx) {
  const ctxPart = buildContextString(ctx);
  return `你是足球视频分析员。请观看这段完整比赛视频（总时长约 ${Math.round(durationSec)} 秒）。

${ctxPart}

【任务】写一段文字总结，并【只在画面上真的有记分牌时】读出比分。

【输出】只输出JSON（不要其他文字）：
{
  "score": {"home": null, "away": null},
  "score_source": "unknown",
  "score_note": null,
  "headline": "一句话概括（具体，如'我方中场控制但最后一传质量差'）",
  "highlight": "最精彩一刻（具体描述动作，如'10号禁区外远射击中横梁'）",
  "weakness": "最大问题（具体）",
  "next_focus": "下一步建议（具体）"
}

【比分规则 · 最重要】
比分只有两个来源，二选一：
  ① 画面上有记分牌 / 直播比分字幕条 / 角标计分（常见于正式比赛高机位直播画面的左上或顶部）
     → 照抄你看到的数字，score_source 填 "scoreboard"，score_note 写记分牌位置（如"左上角字幕条"）
  ② 画面上没有记分牌，或有但看不清数字
     → score 两个都填 null，score_source 填 "unknown"，score_note 填 null
⚠️ 严禁根据"我方进攻更多""场面占优""好像进了"来推测比分。
⚠️ 没在画面上亲眼看到数字，就必须是 null。填 null 是正确答案，不是失败。
⚠️ 也不要因为没看到进球就填 0-0——没看到记分牌一律 null。

【文字规则】
- headline/highlight/weakness/next_focus 必须具体，禁止空话套话
- 不要编造视频里没有发生的事情
- 不要在文字里提及具体比分`;
}

// ============================================================
// JSON 解析工具
// ============================================================

function extractJsonFromText(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  const unfenced = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch (_) {}
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(unfenced.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

// ============================================================
// 合并 5 轮结果 → dashboard
// ============================================================

const emptyPlayerStats = () => ({
  touches: 0, touches_success: 0, turnovers: 0, dispossessed: 0,
  passes: 0, passes_success: 0, pass_errors: 0,
  shots: 0, shots_on_target: 0,
  dribbles: 0, interceptions: 0, tackles: 0, goals: 0, assists: 0,
});

function mergeRoundsToDashboard(rounds, durationSec) {
  const playerRound = rounds.players?.parsed;
  const passRound = rounds.passes?.parsed;
  const shotRound = rounds.shots?.parsed;
  const defRound = rounds.defense?.parsed;
  const summaryRound = rounds.summary?.parsed;

  // --- 收集所有事件（传球/射门/防守轮）---
  const allEvents = [];
  for (const parsed of [passRound, shotRound, defRound]) {
    if (parsed && Array.isArray(parsed.events)) {
      for (const evt of parsed.events) {
        allEvents.push({
          time_seconds: evt.time_seconds ?? null,
          clock: typeof evt.clock === "string" && evt.clock.trim() ? evt.clock.trim() : null,
          type: evt.type ?? null,
          team: evt.team ?? null,
          player_number: evt.player_number ?? null,
          outcome: evt.outcome ?? null,
          note: evt.note ?? null,
          source: "qwen-vlm",
        });
      }
    }
  }
  allEvents.sort((a, b) => (a.time_seconds || 0) - (b.time_seconds || 0));

  // 去重：同类型 + 同球员 + 时间±1.5秒 → 只留第一条
  const deduped = [];
  for (const evt of allEvents) {
    const dup = deduped.find((e) =>
      e.type === evt.type &&
      e.player_number === evt.player_number &&
      Math.abs((e.time_seconds || 0) - (evt.time_seconds || 0)) < 1.5
    );
    if (!dup) deduped.push(evt);
  }

  // --- 球员（来自第1轮，事件补充统计）---
  const cleanText = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const asNum = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  // 模型偶尔会退化成空话，这类句子对用户没有价值，直接丢掉。
  const EMPTY_TALK = /^(表现不错|比较活跃|有一定贡献|值得肯定|整体表现良好|发挥稳定|表现一般)[。.!！]?$/;
  const cleanList = (v, limit) => {
    const list = Array.isArray(v) ? v : v == null ? [] : [v];
    const out = [];
    for (const item of list) {
      const s = cleanText(item);
      if (!s || EMPTY_TALK.test(s)) continue;
      if (!out.includes(s)) out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  };

  const playerMap = {};
  if (playerRound && Array.isArray(playerRound.players)) {
    for (const p of playerRound.players) {
      const num = cleanText(p.number);
      if (!num) continue;
      playerMap[num] = {
        number: num,
        name: null,
        // 位置识别实测不可靠（会把后卫认成前锋），已彻底不再输出
        position: null,
        score: null,
        role: cleanText(p.role),
        tags: cleanList(p.tags, 4),
        is_mvp: p.is_mvp === true,
        stats: emptyPlayerStats(),
        insights: cleanList(p.notes ?? p.note, 3),
        events: [], title: null, highlight: null, source: "qwen-vlm",
      };
    }
  }

  // 把事件归到球员 + 累加统计
  for (const [pn, pl] of Object.entries(playerMap)) {
    for (const evt of deduped) {
      if (evt.player_number && String(evt.player_number) === pn) pl.events.push({ ...evt });
    }
    const s = pl.stats;
    for (const evt of pl.events) {
      const t = (evt.type || "").toLowerCase();
      s.touches += 1;
      if (evt.outcome === "success") s.touches_success += 1;
      if (t === "pass") { s.passes += 1; if (evt.outcome === "success") s.passes_success += 1; else if (evt.outcome === "failed") s.pass_errors += 1; }
      else if (t === "shot") { s.shots += 1; if (evt.outcome === "success") s.shots_on_target += 1; }
      else if (t === "tackle") s.tackles += 1;
      else if (t === "interception") s.interceptions += 1;
      else if (t === "dribble") s.dribbles += 1;
      else if (t === "dispossessed") s.dispossessed += 1;
      else if (t === "turnover") s.turnovers += 1;
      else if (t === "goal") s.goals += 1;
    }
  }

  const players = Object.values(playerMap);

  // MVP 只允许一个：模型有时会给多个 true，只保留第一个
  let mvpTaken = false;
  for (const pl of players) {
    if (pl.is_mvp && !mvpTaken) mvpTaken = true;
    else pl.is_mvp = false;
  }
  // 有球员但模型没选 MVP → 用"评语条数最多"的那个兜底
  if (!mvpTaken && players.length) {
    const best = players.reduce((a, b) => (b.insights.length > a.insights.length ? b : a), players[0]);
    if (best.insights.length) best.is_mvp = true;
  }

  // --- 团队统计（从事件推导）---
  const teamStats = { home: {}, away: {} };
  for (const evt of deduped) {
    const side = evt.team || "home";
    const k = (evt.type || "").toLowerCase();
    if (!teamStats[side]) teamStats[side] = {};
    teamStats[side][k] = (teamStats[side][k] || 0) + 1;
  }

  const buildTeam = (side) => {
    const ts = teamStats[side] || {};
    return {
      id: null,
      name: side === "home" ? "我方" : "对方",
      score: null,
      possession_pct: null,
      shots: ts.shot || null,
      shots_on_target: deduped.filter((e) => e.team === side && e.type === "shot" && e.outcome === "success").length || null,
      average_score: null,
      stats: {
        passes: ts.pass || null,
        passes_success: deduped.filter((e) => e.team === side && e.type === "pass" && e.outcome === "success").length || null,
        pass_errors: deduped.filter((e) => e.team === side && e.type === "pass" && e.outcome === "failed").length || null,
        shots: ts.shot || null,
        shots_on_target: deduped.filter((e) => e.team === side && e.type === "shot" && e.outcome === "success").length || null,
        touches: ((ts.pass || 0) + (ts.shot || 0) + (ts.dribble || 0) + (ts.touch || 0) + (ts.tackle || 0) + (ts.interception || 0)) || null,
        touches_success: null,
        turnovers: ((ts.turnover || 0) + (ts.dispossessed || 0)) || null,
        dispossessed: ts.dispossessed || null,
        dribbles: ts.dribble || null,
        interceptions: ts.interception || null,
        tackles: ts.tackle || null,
        goals: ts.goal || null,
        assists: null,
      },
      highlights: [],
      weaknesses: [],
      next_focus: [],
    };
  };

  const dashboard = {
    schema_version: "1.0",
    source: "qwen-vlm",
    data_status: "model_estimate",
    notes: ["多轮整视频直传(qwen-vl-max) 5轮合并：球员/传球/射门/防守/总结"],
    match: (() => {
      const rawHome = asNum(summaryRound?.score?.home);
      const rawAway = asNum(summaryRound?.score?.away);
      // 比分只承认"画面记分牌读出来的"，模型自己推测的一律作废
      const claimed = String(summaryRound?.score_source || "").trim().toLowerCase() === "scoreboard";
      const trusted = claimed && rawHome !== null && rawAway !== null;
      return {
        name: null,
        duration_seconds: Math.round(durationSec) || null,
        score: { home: trusted ? rawHome : null, away: trusted ? rawAway : null },
        score_source: trusted ? "scoreboard" : "unknown",
        score_note: trusted ? cleanText(summaryRound?.score_note) : null,
      };
    })(),
    teams: { home: buildTeam("home"), away: buildTeam("away") },
    summary: {
      headline: summaryRound?.headline || null,
      highlight: summaryRound?.highlight || null,
      weakness: summaryRound?.weakness || null,
      next_focus: summaryRound?.next_focus || null,
    },
    players,
    events: deduped,
    source_frames: [],
  };

  // 注入总结里的 highlights/weaknesses 到球队
  if (summaryRound?.highlight) dashboard.teams.home.highlights.push(summaryRound.highlight);
  if (summaryRound?.weakness) dashboard.teams.home.weaknesses.push(summaryRound.weakness);

  return dashboard;
}

// ============================================================
// Mock（无 API Key 时）
// ============================================================

function mockSummary(task) {
  const dur = task?.input?.duration_seconds ? Math.round(task.input.duration_seconds) : 0;
  return `【即时分析 · 演示模式】\n尚未配置视觉大模型 API Key。\n（视频时长约 ${dur} 秒。配置 VLM_API_KEY 后将输出真实视频理解结果。）`;
}

// ============================================================
// 主入口
// ============================================================

exports.main = async (event) => {
  const data =
    typeof event === "string"
      ? JSON.parse(event)
      : event?.body
        ? typeof event.body === "string" ? JSON.parse(event.body) : event.body
        : event;
  if (data?.selfTest) {
    try { return { ok: true, selfTest: await runSelfTest() }; }
    catch (e) { return { ok: false, error: e?.message || String(e), stack: String(e?.stack || "").slice(0, 600) }; }
  }

  const taskId = data?.taskId || data?.task_id;
  if (!taskId) return { ok: false, error: "missing taskId" };

  try {
    const task = await getTask(taskId);
    if (!task) return { ok: false, error: "task not found: " + taskId };
    if (task.status === "succeeded" && task.text_result) return { ok: true, skipped: true };

    await updateTask(taskId, {
      status: "running", stage: "analyzing", progress: 3,
      started_at: new Date().toISOString(),
      analysis_mode: "multi_round_video",
    });

    let finalResult;
    let inputMode = "demo";

    if (!vlmApiKey) {
      const mockText = mockSummary(task);
      finalResult = {
        content: mockText, raw_content: mockText, model: "demo",
        input_mode: "demo", generated_at: new Date().toISOString(),
        parse_status: "mock", parse_error: null, structured: null,
      };
    } else {
      inputMode = "multi_round_video";
      const signedUrl = await signedGetUrl(task.input_object_key, 7200);
      const rawDuration = Number(task?.input?.duration_seconds) || 0;
      const sizeBytes = Number(task?.input?.size_bytes) || 0;
      const ctx = task?.analysis_context || null;

      // 原片超过千问限制时自动压制（≤120MB / ≤10 分钟）
      const prepared = await ensureVlmPlayable({
        signedUrl, sizeBytes, durationSec: rawDuration, taskId,
        onStage: (stage, note) => updateTask(taskId, { stage, progress: 4, compress_info: note }),
      });
      const videoUrl = prepared.url;
      const durationSec = prepared.seconds;
      console.log(`[vlm] 输入准备: ${prepared.reason}`);

      const rounds = {};
      const roundDefs = [
        ["players", "球员识别", buildPlayersPrompt(durationSec, ctx)],
        ["passes", "传球统计", buildPassPrompt(durationSec, ctx)],
        ["shots", "射门识别", buildShotPrompt(durationSec, ctx)],
        ["defense", "防守事件", buildDefensePrompt(durationSec, ctx)],
        ["summary", "综合总结", buildSummaryPrompt(durationSec, ctx)],
      ];

      for (let i = 0; i < roundDefs.length; i++) {
        const [key, label, prompt] = roundDefs[i];
        const progress = 5 + Math.floor((i / roundDefs.length) * 80); // 5% -> 85%
        try {
          await updateTask(taskId, { stage: `round_${i + 1}_${key}`, progress, round_info: `${label} (${i + 1}/5)` });
          console.log(`[vlm] 第${i + 1}轮 ${label} 开始`);
          const raw = await callQwenWithVideo(videoUrl, prompt);
          const parsed = extractJsonFromText(raw);
          rounds[key] = { label, raw, parsed, success: !!parsed, error: parsed ? null : "JSON解析失败" };
          console.log(`[vlm] 第${i + 1}轮 ${label} 完成, ${raw.length} 字符, 解析${parsed ? "成功" : "失败"}`);
        } catch (err) {
          console.error(`[vlm] 第${i + 1}轮 ${label} 失败:`, err?.message);
          rounds[key] = { label, raw: null, parsed: null, success: false, error: err?.message || String(err) };
          // 单轮失败不中断
        }
      }

      await updateTask(taskId, { stage: "merging", progress: 90 });
      const dashboard = mergeRoundsToDashboard(rounds, durationSec);
      if (prepared?.reason) dashboard.notes = [...(dashboard.notes || []), `视频预处理：${prepared.reason}`];
      if (prepared?.compressed) dashboard.notes = [...(dashboard.notes || []), `（已压缩至 ${((prepared.bytes || 0) / 1048576).toFixed(0)}MB / ${Math.round(durationSec)}秒后分析）`];
      const rawContent = JSON.stringify(dashboard);

      // 用 parseVlmText 统一规范化（幂等）
      const normalized = parseVlmText(rawContent);

      finalResult = {
        content: rawContent,
        raw_content: rawContent,
        model: `${vlmProvider}:${vlmModel}`,
        input_mode: inputMode,
        generated_at: new Date().toISOString(),
        rounds: roundDefs.map(([key, label]) => ({
          round: label,
          success: rounds[key]?.success || false,
          error: rounds[key]?.error || null,
          event_count: Array.isArray(rounds[key]?.parsed?.events) ? rounds[key].parsed.events.length : 0,
          player_count: Array.isArray(rounds[key]?.parsed?.players) ? rounds[key].parsed.players.length : 0,
        })),
        parse_status: normalized.parse_status,
        parse_error: normalized.parse_error,
        structured: normalized.structured || dashboard,
      };
    }

    await updateTask(taskId, {
      status: "succeeded", stage: "completed", progress: 100,
      text_result: finalResult,
      completed_at: new Date().toISOString(),
    });

    return { ok: true, taskId, inputMode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await updateTask(taskId, { status: "failed", stage: "failed", error: { code: "VLM_FAILED", message } });
    } catch (_) {}
    return { ok: false, error: message };
  }
};
