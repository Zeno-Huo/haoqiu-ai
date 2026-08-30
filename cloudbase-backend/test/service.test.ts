import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../index";
import { requireUser, requireWorker } from "../src/auth";
import { loadConfig, loadTencentCredentials } from "../src/config";
import type { Config } from "../src/config";
import type { ObjectMetadata, ObjectStore } from "../src/cos";
import type { TaskRepository } from "../src/repository";
import { TaskService } from "../src/service";
import { haiCompletionBody, publicTask, workerTask } from "../src/http-contract";
import { corsHeaders, DEFAULT_WEB_ORIGIN, parseAllowedWebOrigins, requireAllowedOrigin, requireAllowedPreflight } from "../src/http-cors";
import { ApiError } from "../src/types";
import type { TaskRecord, UploadRecord } from "../src/types";

class FakeObjects implements ObjectStore {
  metadata = new Map<string, ObjectMetadata>();
  putSignatures: Array<{ key: string; expiresSeconds: number }> = [];
  getSignatures: Array<{ key: string; expiresSeconds: number }> = [];
  async signedPutUrl(key: string, expiresSeconds: number) { this.putSignatures.push({ key, expiresSeconds }); return `https://upload.invalid/${key}?short-signature`; }
  async signedGetUrl(key: string, expiresSeconds: number) { this.getSignatures.push({ key, expiresSeconds }); return `https://download.invalid/${key}?short-signature`; }
  async head(key: string) { const value = this.metadata.get(key); if (!value) throw new ApiError(409, "UPLOAD_NOT_FOUND", "missing"); return value; }
  deletedKeys: string[] = [];
  async deleteObject(key: string) { this.deletedKeys.push(key); }
}

class MemoryRepository implements TaskRepository {
  uploads = new Map<string, UploadRecord>();
  tasks = new Map<string, TaskRecord>();
  async createUpload(value: UploadRecord) { this.uploads.set(value._id, value); }
  async getUpload(id: string) { return this.uploads.get(id) || null; }
  async getTask(id: string) { return this.tasks.get(id) || null; }
  async confirmUpload(_upload: UploadRecord, task: TaskRecord) {
    const existing = this.tasks.get(task._id); if (existing) return existing;
    this.tasks.set(task._id, task); return task;
  }
  async claim(workerId: string, leaseSeconds: number, now: Date) {
    const task = [...this.tasks.values()].find((item) =>
      (["queued", "retry_wait"].includes(item.status) && item.available_at <= now) ||
      (["leased", "running"].includes(item.status) && !!item.lease_expires_at && item.lease_expires_at <= now));
    if (!task) return null;
    Object.assign(task, { status: "leased", lease_owner: workerId, lease_token: `token-${task.attempt + 1}`, lease_expires_at: new Date(now.getTime() + leaseSeconds * 1000), attempt: task.attempt + 1, updated_at: now });
    return task;
  }
  private lease(id: string, token: string, now: Date) {
    const task = this.tasks.get(id); if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "missing");
    if (task.lease_token !== token || !task.lease_expires_at || task.lease_expires_at <= now) throw new ApiError(409, "LEASE_LOST", "lost");
    return task;
  }
  async renew(id: string, token: string, seconds: number, now: Date) { const task = this.lease(id, token, now); task.lease_expires_at = new Date(now.getTime() + seconds * 1000); return task; }
  async progress(id: string, token: string, patch: Partial<TaskRecord>, now: Date) { const task = this.lease(id, token, now); Object.assign(task, patch, { status: "running", updated_at: now, started_at: task.started_at || now }); return task; }
  async complete(id: string, token: string, key: string, patch: Partial<TaskRecord>, now: Date) {
    const current = this.tasks.get(id);
    if (current?.status === "succeeded") { if (current.idempotency_key === key) return current; throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "conflict"); }
    const task = this.lease(id, token, now); Object.assign(task, patch, { status: "succeeded", stage: "completed", progress: 100, idempotency_key: key, completed_at: now, updated_at: now }); return task;
  }
  async fail(id: string, token: string, retryable: boolean, error: { code: string; message: string }, now: Date) {
    const task = this.lease(id, token, now); const retry = retryable && task.attempt < task.max_attempts;
    Object.assign(task, { status: retry ? "retry_wait" : "failed", error, available_at: now, updated_at: now }); return task;
  }
  async createInstantTask(task: TaskRecord) { this.tasks.set(task._id, task); return task; }
  async saveInstantResult(id: string, patch: Partial<TaskRecord>, now: Date) {
    const task = this.tasks.get(id); if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "missing");
    Object.assign(task, patch, { updated_at: now });
    if (patch.status === "succeeded" && !task.completed_at) task.completed_at = now;
    return task;
  }
  async deleteTask(id: string) { this.tasks.delete(id); }
  async deleteUpload(id: string) { this.uploads.delete(id); }
  async findTasksByInputKey(inputObjectKey: string) {
    return [...this.tasks.values()].filter((task) => task.input_object_key === inputObjectKey);
  }
  async expireTaskIfStale(id: string, now: Date, ttlSeconds: number) {
    const task = this.tasks.get(id);
    if (!task) return null;
    // 与真实实现一致：未命中过期条件时原样返回，让调用方复用这次读取。
    if (!["queued", "retry_wait"].includes(task.status)) return task;
    if (task.created_at.getTime() > now.getTime() - ttlSeconds * 1000) return task;
    Object.assign(task, {
      status: "failed", stage: "failed", updated_at: now, completed_at: now,
      error: { code: "STALE_QUEUED", message: "任务排队超时，未检测到可处理的工作节点" }
    });
    return task;
  }
}

const config: Config = {
  envId: "test", bucket: "haoqiu-ai-media-1352817304", region: "ap-shanghai",
  uploadUrlSeconds: 600, pendingUploadSeconds: 86400, resultUrlSeconds: 600, workerUrlSeconds: 14400, rawRetentionDays: 7, resultRetentionDays: 30,
  maxUploadBytes: 300 * 1024 * 1024, maxDurationSeconds: 900, maxLeaseSeconds: 120,
  workerToken: "worker-secret", allowTestIdentity: true, allowedWebOrigins: [DEFAULT_WEB_ORIGIN],
  vlmProvider: "qwen", vlmModel: "qwen-vl-plus", queuedTtlSeconds: 1800, cdnBase: undefined
};

test("CORS only reflects exact configured origins and never wildcard", () => {
  assert.deepEqual(parseAllowedWebOrigins(), [DEFAULT_WEB_ORIGIN]);
  assert.deepEqual(parseAllowedWebOrigins("https://a.example,https://b.example,https://a.example"), ["https://a.example", "https://b.example"]);
  assert.throws(() => parseAllowedWebOrigins("*"), /wildcard/);
  assert.throws(() => parseAllowedWebOrigins("https://a.example/path"), /exact HTTP/);
  assert.doesNotThrow(() => requireAllowedOrigin("https://a.example", ["https://a.example"]));
  assert.throws(() => requireAllowedOrigin("https://evil.example", ["https://a.example"]), /来源不允许/);
  assert.doesNotThrow(() => requireAllowedPreflight("POST", "Content-Type, Authorization"));
  // DELETE 已放行：网页端删除云端任务及其视频需要它（此前只删 localStorage，COS 存储永不释放）
  assert.doesNotThrow(() => requireAllowedPreflight("DELETE", "Content-Type"));
  assert.throws(() => requireAllowedPreflight("PATCH", "Content-Type"), /方法不允许/);
  assert.throws(() => requireAllowedPreflight("POST", "X-User-Id"), /请求头不允许/);
  assert.deepEqual(corsHeaders(undefined, ["https://a.example"]), { vary: "Origin" });
  assert.deepEqual(corsHeaders("https://evil.example", ["https://a.example"]), { vary: "Origin" });
  const allowed = corsHeaders("https://a.example", ["https://a.example"]);
  assert.equal(allowed["access-control-allow-origin"], "https://a.example");
  assert.equal(allowed["access-control-allow-credentials"], "true");
  assert.equal(allowed["access-control-allow-methods"], "GET,POST,DELETE,OPTIONS");
  assert.equal(allowed["access-control-allow-headers"], "Authorization,Content-Type");
  assert.ok(!Object.values(allowed).includes("*"));
});

test("HTTP handler answers allowed preflight with 204 and rejects other origins", async () => {
  const preflight = await main({
    httpMethod: "OPTIONS", path: "/api/v1/cos-upload-tickets", headers: { origin: DEFAULT_WEB_ORIGIN }
  }, {});
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.body, "");
  const preflightHeaders: Record<string, string> = preflight.headers;
  assert.equal(preflightHeaders.vary, "Origin");
  assert.equal(preflightHeaders["access-control-allow-origin"], DEFAULT_WEB_ORIGIN);
  assert.equal(preflightHeaders["access-control-allow-credentials"], "true");

  const denied = await main({
    httpMethod: "OPTIONS", path: "/api/v1/cos-upload-tickets", headers: { origin: "https://evil.example" }
  }, {});
  assert.equal(denied.statusCode, 403);
  const deniedHeaders: Record<string, string> = denied.headers;
  assert.equal(deniedHeaders.vary, "Origin");
  assert.equal(deniedHeaders["access-control-allow-origin"], undefined);
});

test("production identity abstraction rejects anonymous users and worker rejects bad bearer", () => {
  assert.equal(requireUser(
    { userInfo: { uid: "legacy-event-user" }, headers: { "x-cloudbase-context": "forged", "x-user-id": "forged" } },
    { extendedContext: { userId: "gateway-user" }, auth: { uid: "legacy-context-user" } },
    false
  ), "gateway-user");
  assert.throws(() => requireUser({ headers: { "x-cloudbase-context": "forged", "x-user-id": "forged", "x-test-user-id": "demo" } }, {}, false), /需要登录/);
  assert.equal(requireUser({ headers: { "X-Test-User-Id": "demo" } }, {}, true), "demo");
  assert.throws(() => requireWorker({ headers: { authorization: "Bearer wrong" } }, "worker-secret", "test"), /invalid worker/);
  assert.throws(() => requireWorker({ headers: { authorization: "Bearer worker-secret", "x-cloudbase-env": "wrong" } }, "worker-secret", "test"), /environment/);
  assert.doesNotThrow(() => requireWorker({ headers: { authorization: "Bearer worker-secret", "x-cloudbase-env": "test" } }, "worker-secret", "test"));
});

test("COS credentials prefer standard Tencent Cloud names and support legacy fallback", () => {
  assert.deepEqual(loadTencentCredentials({
    TENCENTCLOUD_SECRETID: "standard-id", TENCENTCLOUD_SECRETKEY: "standard-key", TENCENTCLOUD_SESSIONTOKEN: "standard-token",
    TENCENT_SECRET_ID: "legacy-id", TENCENT_SECRET_KEY: "legacy-key", TENCENT_SESSION_TOKEN: "legacy-token"
  }), { SecretId: "standard-id", SecretKey: "standard-key", SecurityToken: "standard-token" });
  assert.deepEqual(loadTencentCredentials({
    TENCENT_SECRET_ID: "legacy-id", TENCENT_SECRET_KEY: "legacy-key", TENCENT_SESSION_TOKEN: "legacy-token"
  }), { SecretId: "legacy-id", SecretKey: "legacy-key", SecurityToken: "legacy-token" });
});

test("worker signed URL lifetime is capped at six hours", () => {
  const previous = process.env.WORKER_URL_SECONDS;
  process.env.WORKER_URL_SECONDS = String(24 * 60 * 60);
  try { assert.equal(loadConfig().workerUrlSeconds, 6 * 60 * 60); }
  finally {
    if (previous === undefined) delete process.env.WORKER_URL_SECONDS;
    else process.env.WORKER_URL_SECONDS = previous;
  }
});

test("HAI completion contract maps idempotency header and nested result", () => {
  assert.deepEqual(haiCompletionBody("task_01", {
    lease_token: "lease_01",
    result: {
      artifact: { object_key: "outputs/u/task_01/annotated.mp4", etag: "e1", size_bytes: 42, content_type: "video/mp4" },
      detection: { diagnostics: { processed_frames: 10 }, warnings: ["warning"] }
    }
  }, "task_01:annotated-video:v1"), {
    task_id: "task_01", lease_token: "lease_01", idempotency_key: "task_01:annotated-video:v1",
    output: { object_key: "outputs/u/task_01/annotated.mp4", etag: "e1", size_bytes: 42, content_type: "video/mp4" },
    diagnostics: { processed_frames: 10 }, warnings: ["warning"], model: undefined
  });
});

test("upload enforces size and duration boundaries and server-generates keys", async () => {
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => new Date("2026-08-24T00:00:00Z"));
  // 只校验"超限被拒"的语义，不绑定具体数字：报错文案写死 1GB / 20 分钟，
  // 而本测试 config 用的是 300MB / 15 分钟，写死数字会让断言与产品实际限制脱节（此前一直误报失败）。
  await assert.rejects(api.issueUpload("u1", { filename: "a.mp4", content_type: "video/mp4", size_bytes: config.maxUploadBytes + 1, duration_seconds: 10 }), /视频不得超过/);
  await assert.rejects(api.issueUpload("u1", { filename: "a.mp4", content_type: "video/mp4", size_bytes: 100, duration_seconds: 901 }), /视频不得超过/);
  const ticket = await api.issueUpload("u1", { filename: "../../unsafe.MOV", content_type: "video/quicktime", size_bytes: config.maxUploadBytes, duration_seconds: 900 });
  assert.equal(ticket.method, "PUT");
  assert.deepEqual(ticket.headers, {});
  assert.match(ticket.upload_url, /^https:\/\/upload\.invalid\/inputs\/u1\/task_[a-z0-9]+\/source\.mov\?short-signature$/);
  assert.ok(!ticket.upload_url.includes("unsafe"));
  assert.equal("object_key" in ticket, false);
});

test("confirm, atomic lease flow, deterministic output and completion idempotency", async () => {
  let current = new Date("2026-08-24T00:00:00Z");
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => current);
  const ticket = await api.issueUpload("u1", { filename: "match.mp4", content_type: "video/mp4", size_bytes: 1234, duration_seconds: 20, client_match_id: "m1" });
  const inputKey = repo.uploads.get(ticket.upload_id)!.input_object_key;
  objects.metadata.set(inputKey, { sizeBytes: 1234, etag: "raw-etag" });
  current = new Date(current.getTime() + 700_000); // PUT URL expired; pending confirmation remains valid.
  await assert.rejects(api.confirmUpload("u1", ticket.upload_id, "another-match"), /比赛标识/);
  const task = await api.confirmUpload("u1", ticket.upload_id, "m1");
  assert.strictEqual(await api.confirmUpload("u1", ticket.upload_id, "m1"), task);
  const claimed = await api.claim({ worker_id: "hai-1", lease_seconds: 60 });
  assert.equal(claimed?.attempt, 1); assert.ok(claimed?.lease_token);
  assert.equal(claimed?.input_object_key, inputKey);
  assert.match(claimed!.input_download_url, /^https:\/\/download\.invalid\/inputs\//);
  assert.match(claimed!.output_upload_url, /^https:\/\/upload\.invalid\/outputs\//);
  assert.equal(new Date(claimed!.signed_url_expires_at).getTime(), current.getTime() + 14_400_000);
  assert.deepEqual(objects.getSignatures.at(-1), { key: task.input_object_key, expiresSeconds: 14_400 });
  assert.deepEqual(objects.putSignatures.at(-1), { key: task.output_object_key, expiresSeconds: 14_400 });
  const claimedPayload = workerTask(claimed!);
  assert.equal(claimedPayload!.input_object_key, inputKey);
  assert.equal(claimedPayload!.input_download_url, claimed!.input_download_url);
  assert.equal(claimedPayload!.output_upload_url, claimed!.output_upload_url);
  await api.progress({ task_id: task._id, lease_token: claimed!.lease_token, progress: 50, stage: "detecting" });
  const completeBody = { task_id: task._id, lease_token: claimed!.lease_token, idempotency_key: "result-etag-v1", output: { object_key: task.output_object_key, etag: "result-etag", size_bytes: 999 }, diagnostics: { processed_frames: 10 } };
  const completed = await api.complete(completeBody);
  const replay = await api.complete({ ...completeBody, lease_token: "already-cleared-or-expired" });
  assert.strictEqual(replay, completed);
  assert.equal(completed.status, "succeeded");
  assert.ok(completed.raw_lifecycle.delete_after);
  assert.ok(completed.result_lifecycle.delete_after);
  const signed = await api.resultUrl("u1", task._id);
  assert.match(signed.url, /^https:\/\/download\.invalid\/outputs\//);
  assert.equal(signed.content_type, "video/mp4");
  assert.equal(new Date(signed.expires_at).getTime(), current.getTime() + 600_000);
  assert.deepEqual(publicTask(completed).artifacts, { annotated_video_ready: true });
  await assert.rejects(api.resultUrl("another-user", task._id), /任务不存在/);

  current = new Date("2026-08-25T00:00:00Z");
});

test("expired leases cannot report progress", async () => {
  let current = new Date("2026-08-24T00:00:00Z");
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => current);
  const ticket = await api.issueUpload("u1", { filename: "x.mp4", content_type: "video/mp4", size_bytes: 1, duration_seconds: 1 });
  objects.metadata.set(repo.uploads.get(ticket.upload_id)!.input_object_key, { sizeBytes: 1, etag: "e" }); await api.confirmUpload("u1", ticket.upload_id);
  const claimed = await api.claim({ worker_id: "hai-1", lease_seconds: 10 });
  current = new Date(current.getTime() + 11_000);
  await assert.rejects(api.progress({ task_id: ticket.upload_id, lease_token: claimed!.lease_token, progress: 1, stage: "probing" }), /lost/);
});

test("deleting a task frees its video only when no sibling task still references it", async () => {
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => new Date("2026-08-24T00:00:00Z"));
  const ticket = await api.issueUpload("u1", { filename: "del.mp4", content_type: "video/mp4", size_bytes: 1234, duration_seconds: 20 });
  const uploadId = ticket.upload_id;
  const inputKey = repo.uploads.get(uploadId)!.input_object_key;
  const outputKey = repo.uploads.get(uploadId)!.output_object_key;
  objects.metadata.set(inputKey, { sizeBytes: 1234, etag: "raw-etag" });
  // deep 与 instant 共用同一段上传视频，这是删除时最容易误伤的场景
  const deepTask = await api.confirmUpload("u1", uploadId);
  const instantTask = await api.createInstantJob("u1", uploadId);

  await assert.rejects(() => api.deleteTaskForUser("u2", deepTask._id), /任务不存在/);

  // 先删 instant：deep 仍在引用同一段视频，视频必须保留
  const first = await api.deleteTaskForUser("u1", instantTask._id);
  assert.deepEqual(first.deleted_objects, []);
  assert.equal(repo.tasks.has(instantTask._id), false);
  assert.deepEqual(objects.deletedKeys, []);

  // 再删 deep：已无其它引用，视频应当被回收
  const second = await api.deleteTaskForUser("u1", deepTask._id);
  assert.deepEqual([...second.deleted_objects].sort(), [inputKey, outputKey].sort());
  assert.deepEqual([...objects.deletedKeys].sort(), [inputKey, outputKey].sort());
  assert.equal(repo.tasks.has(deepTask._id), false);
});

test("queued tasks never claimed are failed after the TTL instead of looping forever", async () => {
  let current = new Date("2026-08-24T00:00:00Z");
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => current);
  const ticket = await api.issueUpload("u1", { filename: "stale.mp4", content_type: "video/mp4", size_bytes: 1234, duration_seconds: 20 });
  const uploadId = ticket.upload_id;
  objects.metadata.set(repo.uploads.get(uploadId)!.input_object_key, { sizeBytes: 1234, etag: "raw-etag" });
  await api.confirmUpload("u1", uploadId);

  // 刚入队：未超时应保持 queued，不能被误判
  const fresh = await api.taskForUser("u1", uploadId);
  assert.equal(fresh.status, "queued");

  // 超过 TTL 仍无人领取 → 判为失败，前端才会停止轮询
  current = new Date(current.getTime() + (config.queuedTtlSeconds + 60) * 1000);
  const stale = await api.taskForUser("u1", uploadId);
  assert.equal(stale.status, "failed");
  assert.equal(stale.error && stale.error.code, "STALE_QUEUED");
});
