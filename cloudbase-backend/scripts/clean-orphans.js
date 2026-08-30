"use strict";

/**
 * 孤儿数据清理（破坏性操作，默认 dry-run，绝不静默删除）
 *
 * 背景：网页端删除此前只清 localStorage，COS 上的任务 JSON 与视频从未释放，
 * 测试视频会一直堆积产生外网下行流量费。本脚本在 list-orphans.js 基础上增加删除，
 * 但严格遵守「先列清单 → 人工确认 → 再删」原则。
 *
 * 用法（需要腾讯云主账号凭证，与后端云函数同款环境变量）：
 *   # 第一步：只看清单，不删
 *   TENCENTCLOUD_SECRETID=xxx TENCENTCLOUD_SECRETKEY=yyy node scripts/clean-orphans.js
 *   # 第二步：确认清单无误后，真正删除（会再次要求输入 YES）
 *   TENCENTCLOUD_SECRETID=xxx TENCENTCLOUD_SECRETKEY=yyy node scripts/clean-orphans.js --apply
 *
 * 删除顺序遵循「先删视频后删任务」原则，避免留下「任务已删、重试只会 404」的永久孤儿。
 * 孤儿定义：无任何上传记录 / 任务引用的视频，以及从未被领取的排队任务、失败任务、pending 残留。
 */

const COS = require("cos-nodejs-sdk-v5");
const readline = require("readline");

const bucket = process.env.COS_BUCKET || "haoqiu-ai-media-1352817304";
const region = process.env.COS_REGION || "ap-shanghai";

const SecretId = process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID;
const SecretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY;
if (!SecretId || !SecretKey) {
  console.error("缺少凭证：请设置 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY");
  process.exit(1);
}
const cos = new COS({
  SecretId,
  SecretKey,
  SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENT_SESSION_TOKEN,
});

/** 分页列出某个前缀下的全部对象（不截断）。 */
async function listAll(prefix) {
  const out = [];
  let marker;
  for (;;) {
    const data = await new Promise((resolve, reject) =>
      cos.getBucket(
        { Bucket: bucket, Region: region, Prefix: prefix, Marker: marker, MaxKeys: 1000 },
        (err, d) => (err ? reject(err) : resolve(d))
      )
    );
    for (const c of data.Contents || []) {
      out.push({ key: c.Key, size: Number(c.Size || 0), lastModified: c.LastModified });
    }
    if (!data.IsTruncated) break;
    marker = data.NextMarker;
    if (!marker) break;
  }
  return out;
}

async function getJson(key) {
  try {
    const data = await new Promise((resolve, reject) =>
      cos.getObject({ Bucket: bucket, Region: region, Key: key }, (err, d) => (err ? reject(err) : resolve(d)))
    );
    const body = data && data.Body;
    if (!body) return null;
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function deleteObject(key) {
  return new Promise((resolve, reject) =>
    cos.deleteObject({ Bucket: bucket, Region: region, Key: key }, (err, d) =>
      err ? reject(err) : resolve(d)
    )
  );
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const totalBytes = (arr) => arr.reduce((sum, f) => sum + f.size, 0);
const ageDays = (value) => (value ? ((Date.now() - new Date(value).getTime()) / 86400000).toFixed(1) : "?");

(async () => {
  console.log(`桶 ${bucket} (${region})  ·  孤儿清理扫描\n`);

  const [uploadFiles, taskFiles, inputFiles, outputFiles] = await Promise.all([
    listAll("db/upload/"),
    listAll("db/task/"),
    listAll("inputs/"),
    listAll("outputs/"),
  ]);

  const uploads = [];
  for (const f of uploadFiles) {
    const record = await getJson(f.key);
    if (record) uploads.push(record);
  }
  const tasks = [];
  for (const f of taskFiles) {
    const record = await getJson(f.key);
    if (record) tasks.push(record);
  }

  const referencedOutputs = new Set(tasks.map((t) => t.output_object_key).filter(Boolean));

  // 成功出过报告的比赛视频必须保留；其余 inputs 视频（无引用 / 仅被失败·卡住·pending 记录引用）一律可清理。
  const valuableInputs = new Set(
    tasks.filter((t) => t.status === "succeeded").map((t) => t.input_object_key).filter(Boolean)
  );
  const orphanOutputs = outputFiles.filter((f) => !referencedOutputs.has(f.key));
  const stuckTasks = tasks.filter((t) => t.status === "queued" && (t.attempt || 0) === 0);
  const failedTasks = tasks.filter((t) => t.status === "failed");
  const pendingUploads = uploads.filter((u) => u.status === "pending");

  const deadInputVideos = inputFiles.filter((f) => !valuableInputs.has(f.key));
  const videoTargets = [...deadInputVideos, ...orphanOutputs];
  const jsonTargets = [
    ...stuckTasks.map((t) => ({ key: `db/task/${t._id}.json`, label: `排队任务 ${t._id}` })),
    ...failedTasks.map((t) => ({ key: `db/task/${t._id}.json`, label: `失败任务 ${t._id}` })),
    ...pendingUploads.map((u) => ({ key: `db/upload/${u._id}.json`, label: `pending 上传 ${u._id}` })),
  ];

  console.log("=== 将清理的对象 ===");
  console.log(`无成功报告的原始视频 : ${deadInputVideos.length} 个，共 ${mb(totalBytes(deadInputVideos))}`);
  console.log(`孤儿标注视频 : ${orphanOutputs.length} 个，共 ${mb(totalBytes(orphanOutputs))}`);
  console.log(`从未被领的排队任务 : ${stuckTasks.length} 个`);
  console.log(`已失败任务         : ${failedTasks.length} 个`);
  console.log(`未确认上传记录     : ${pendingUploads.length} 个`);
  console.log(`视频合计释放 : ${mb(totalBytes(videoTargets))}`);

  if (!videoTargets.length && !jsonTargets.length) {
    console.log("\n没有可清理的孤儿数据，无需操作。");
    return;
  }

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("\n【DRY-RUN】以上仅为预览，未删除任何对象。");
    console.log("确认清单无误后运行：node scripts/clean-orphans.js --apply （会再次要求输入 YES）");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((resolve) =>
    rl.question(`\n将永久删除 ${videoTargets.length} 个视频 + ${jsonTargets.length} 个任务/上传记录，输入 YES 确认: `, resolve)
  );
  rl.close();
  if (ans.trim() !== "YES") {
    console.log("已取消，未删除任何对象。");
    return;
  }

  // 先删视频（inputs + outputs），再删任务/上传 JSON，遵循「先删视频后删任务」原则。
  let deletedVideos = 0;
  let freedBytes = 0;
  for (const f of videoTargets) {
    try {
      await deleteObject(f.key);
      deletedVideos += 1;
      freedBytes += f.size;
      console.log(`  删视频 ${mb(f.size).padStart(10)}  ${f.key}`);
    } catch (e) {
      console.error(`  视频删除失败 ${f.key}: ${e.message}`);
    }
  }
  let deletedJson = 0;
  for (const j of jsonTargets) {
    try {
      await deleteObject(j.key);
      deletedJson += 1;
      console.log(`  删记录 ${j.key}`);
    } catch (e) {
      console.error(`  记录删除失败 ${j.key}: ${e.message}`);
    }
  }
  console.log(`\n完成：删除 ${deletedVideos} 个视频（释放 ${mb(freedBytes)}）+ ${deletedJson} 个任务/上传记录。`);
})().catch((error) => {
  console.error("清理失败:", error && error.message ? error.message : error);
  process.exit(1);
});
