"use strict";

/**
 * 孤儿数据清单（只读，绝不删除任何对象）
 *
 * 用途：网页端删除此前只清 localStorage，COS 上的任务 JSON 与视频从未释放，
 * 测试视频会一直堆积。这个脚本把桶里的上传记录、任务、视频文件列出来并交叉比对，
 * 标出哪些是孤儿数据，供人工确认后再决定清理范围。
 *
 * 用法（需要腾讯云凭证，与后端云函数同款环境变量）：
 *   TENCENTCLOUD_SECRETID=xxx TENCENTCLOUD_SECRETKEY=yyy node scripts/list-orphans.js
 * 可选：COS_BUCKET / COS_REGION（默认 haoqiu-ai-media-1352817304 / ap-shanghai）
 */

const COS = require("cos-nodejs-sdk-v5");

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

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const totalBytes = (arr) => arr.reduce((sum, f) => sum + f.size, 0);
const ageDays = (value) => (value ? ((Date.now() - new Date(value).getTime()) / 86400000).toFixed(1) : "?");

(async () => {
  console.log(`桶 ${bucket} (${region})  ·  只读扫描，不做任何删除\n`);

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

  const referencedInputs = new Set(
    [...uploads.map((u) => u.input_object_key), ...tasks.map((t) => t.input_object_key)].filter(Boolean)
  );
  const referencedOutputs = new Set(tasks.map((t) => t.output_object_key).filter(Boolean));

  // 没有任何上传记录或任务引用的视频 = 孤儿
  const orphanInputs = inputFiles.filter((f) => !referencedInputs.has(f.key));
  const orphanOutputs = outputFiles.filter((f) => !referencedOutputs.has(f.key));

  // 卡住/失败的任务：queued 且 attempt 为 0 说明从未被 worker 领走过
  const stuckTasks = tasks.filter((t) => t.status === "queued" && (t.attempt || 0) === 0);
  const failedTasks = tasks.filter((t) => t.status === "failed");
  // 上传了但从没确认生成任务的记录（pending 残留）
  const pendingUploads = uploads.filter((u) => u.status === "pending");

  console.log("=== 汇总 ===");
  console.log(`上传记录 JSON : ${uploads.length}`);
  console.log(`任务 JSON     : ${tasks.length}`);
  console.log(`原始视频      : ${inputFiles.length} 个，共 ${mb(totalBytes(inputFiles))}`);
  console.log(`标注视频      : ${outputFiles.length} 个，共 ${mb(totalBytes(outputFiles))}`);
  console.log("");
  console.log(`【可清理】孤儿原始视频 : ${orphanInputs.length} 个，共 ${mb(totalBytes(orphanInputs))}`);
  console.log(`【可清理】孤儿标注视频 : ${orphanOutputs.length} 个，共 ${mb(totalBytes(orphanOutputs))}`);
  console.log(`【可清理】从未被领的排队任务 : ${stuckTasks.length} 个`);
  console.log(`【可清理】已失败任务         : ${failedTasks.length} 个`);
  console.log(`【可清理】未确认上传记录     : ${pendingUploads.length} 个`);

  const detail = (title, rows) => {
    if (!rows.length) return;
    console.log(`\n=== ${title} ===`);
    for (const r of rows) console.log(`  ${r}`);
  };

  detail(
    "孤儿原始视频（无任何记录引用）",
    orphanInputs.map((f) => `${mb(f.size).padStart(10)}  ${ageDays(f.lastModified)}天前  ${f.key}`)
  );
  detail(
    "孤儿标注视频（无任何任务引用）",
    orphanOutputs.map((f) => `${mb(f.size).padStart(10)}  ${ageDays(f.lastModified)}天前  ${f.key}`)
  );
  detail(
    "从未被引领的排队任务（worker 不在线导致）",
    stuckTasks.map((t) => `${t._id}  attempt=${t.attempt || 0}  ${ageDays(t.created_at)}天前`)
  );
  detail(
    "已失败任务",
    failedTasks.map((t) => `${t._id}  ${t.error ? t.error.code : "?"}  ${ageDays(t.created_at)}天前`)
  );
  detail(
    "未确认上传（pending 残留）",
    pendingUploads.map((u) => `${u._id}  ${ageDays(u.created_at)}天前`)
  );

  console.log("\n提示：以上仅为清单，未删除任何对象。确认后可用 cos.deleteObject 按 key 清理。");
})().catch((error) => {
  console.error("扫描失败:", error && error.message ? error.message : error);
  process.exit(1);
});
