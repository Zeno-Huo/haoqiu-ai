import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../index";
import { requireUser } from "../src/auth";
import { loadConfig, loadTencentCredentials } from "../src/config";
import type { Config } from "../src/config";
import type { ObjectMetadata, ObjectStore } from "../src/cos";
import type { TaskRepository } from "../src/repository";
import { TaskService } from "../src/service";
import { publicTask } from "../src/http-contract";
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
  uploadUrlSeconds: 600, pendingUploadSeconds: 86400, rawRetentionDays: 7, 
  maxUploadBytes: 300 * 1024 * 1024, maxDurationSeconds: 900,
  allowTestIdentity: true, allowedWebOrigins: [DEFAULT_WEB_ORIGIN],
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

test("production identity abstraction rejects forged headers and anonymous users", () => {
  assert.equal(requireUser(
    { userInfo: { uid: "legacy-event-user" }, headers: { "x-cloudbase-context": "forged", "x-user-id": "forged" } },
    { extendedContext: { userId: "gateway-user" }, auth: { uid: "legacy-context-user" } },
    false
  ), "gateway-user");
  assert.throws(() => requireUser({ headers: { "x-cloudbase-context": "forged", "x-user-id": "forged", "x-test-user-id": "demo" } }, {}, false), /需要登录/);
  assert.equal(requireUser({ headers: { "X-Test-User-Id": "demo" } }, {}, true), "demo");
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

test("deleting a task frees its video only when no sibling task still references it", async () => {
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => new Date("2026-08-24T00:00:00Z"));
  const ticket = await api.issueUpload("u1", { filename: "del.mp4", content_type: "video/mp4", size_bytes: 1234, duration_seconds: 20 });
  const uploadId = ticket.upload_id;
  const inputKey = repo.uploads.get(uploadId)!.input_object_key;
  objects.metadata.set(inputKey, { sizeBytes: 1234, etag: "raw-etag" });
  // 团队任务由 VLM 入口创建；个人任务目前还没有 service 入口（第三步开发），
  // 这里直接落库一个同视频的个人任务，用来验证"还有兄弟任务时不能回收视频"。
  const instantTask = await api.createInstantJob("u1", uploadId);
  const personalTask = await repo.createInstantTask({
    ...(await repo.getTask(instantTask._id))!, _id: uploadId, mode: "single",
  });

  await assert.rejects(() => api.deleteTaskForUser("u2", personalTask._id), /任务不存在/);

  // 先删 instant：deep 仍在引用同一段视频，视频必须保留
  const first = await api.deleteTaskForUser("u1", instantTask._id);
  assert.deepEqual(first.deleted_objects, []);
  assert.equal(repo.tasks.has(instantTask._id), false);
  assert.deepEqual(objects.deletedKeys, []);

  // 再删 deep：已无其它引用，视频应当被回收
  const second = await api.deleteTaskForUser("u1", personalTask._id);
  assert.deepEqual([...second.deleted_objects].sort(), [inputKey]);
  assert.deepEqual([...objects.deletedKeys].sort(), [inputKey]);
  assert.equal(repo.tasks.has(personalTask._id), false);
});

test("queued tasks never claimed are failed after the TTL instead of looping forever", async () => {
  let current = new Date("2026-08-24T00:00:00Z");
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => current);
  const ticket = await api.issueUpload("u1", { filename: "stale.mp4", content_type: "video/mp4", size_bytes: 1234, duration_seconds: 20 });
  const uploadId = ticket.upload_id;
  objects.metadata.set(repo.uploads.get(uploadId)!.input_object_key, { sizeBytes: 1234, etag: "raw-etag" });
  const created = await api.createInstantJob("u1", uploadId);

  // 刚入队：未超时应保持 queued，不能被误判
  const fresh = await api.taskForUser("u1", created._id);
  assert.equal(fresh.status, "queued");

  // 超过 TTL 仍无人领取 → 判为失败，前端才会停止轮询
  current = new Date(current.getTime() + (config.queuedTtlSeconds + 60) * 1000);
  const stale = await api.taskForUser("u1", created._id);
  assert.equal(stale.status, "failed");
  assert.equal(stale.error && stale.error.code, "STALE_QUEUED");
});
