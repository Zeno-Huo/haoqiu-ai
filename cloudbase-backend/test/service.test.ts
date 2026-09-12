import assert from "node:assert/strict";
import test from "node:test";
import { main, createHandler } from "../index";
import { requireWorker } from "../src/auth";
import { RcRepository } from "../src/rc-repository";
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

const dispatchModule: typeof import('../src/dispatch') = require('../src/dispatch');

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
  async createInstantTask(task: TaskRecord) {
    const existing = this.tasks.get(task._id);
    if (existing) return { task: existing, created: false };
    this.tasks.set(task._id, task); return { task, created: true };
  }
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
  vlmProvider: "qwen", vlmModel: "qwen-vl-plus", queuedTtlSeconds: 1800, cdnBase: undefined, resultUrlSeconds: 300
};

async function readyUpload(now = () => new Date('2026-09-12T00:00:00Z')) {
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, now);
  const ticket = await api.issueUpload('u1', { filename: 'test.webm', content_type: 'video/webm', size_bytes: 123, duration_seconds: 30 });
  objects.metadata.set(repo.uploads.get(ticket.upload_id)!.input_object_key, { sizeBytes: 123, etag: 'test' });
  return { repo, objects, api, ticket };
}

test('queued RC polling dispatches after 60s, respects owner/status, and keeps TTL', async t => {
  let now = new Date('2026-09-12T00:00:00Z');
  const { api, ticket, repo } = await readyUpload(() => now);
  const dispatch = t.mock.method(dispatchModule, 'dispatchAnalysis', async () => 'offline');
  const { task } = await api.createInstantJob('u1', ticket.upload_id);
  assert.equal(dispatch.mock.callCount(), 0, 'new creation is dispatched only by the entry');
  for (const seconds of [0, 59, 60]) {
    now = new Date(task.created_at.getTime() + seconds * 1000);
    await api.taskForUser('u1', task._id);
  }
  assert.equal(dispatch.mock.callCount(), 0);
  now = new Date(task.created_at.getTime() + 61_000);
  await assert.rejects(api.taskForUser('other', task._id), /任务不存在/);
  assert.equal(dispatch.mock.callCount(), 0);
  assert.equal((await api.taskForUser('u1', task._id)).status, 'queued');
  assert.deepEqual(dispatch.mock.calls[0].arguments, [task._id]);
  assert.equal(dispatch.mock.callCount(), 1);
  for (const status of ['running', 'succeeded', 'failed'] as const) {
    repo.tasks.set(task._id, { ...task, status });
    await api.taskForUser('u1', task._id);
  }
  assert.equal(dispatch.mock.callCount(), 1);
  repo.tasks.set(task._id, { ...task, status: 'queued' });
  now = new Date(task.created_at.getTime() + config.queuedTtlSeconds * 1000);
  assert.equal((await api.taskForUser('u1', task._id)).error?.code, 'STALE_QUEUED');
  assert.equal(dispatch.mock.callCount(), 1);
});

test('polling dispatch failure is swallowed and a later poll retries', async t => {
  let now = new Date('2026-09-12T00:00:00Z');
  const { api, ticket } = await readyUpload(() => now);
  const dispatch = t.mock.method(dispatchModule, 'dispatchAnalysis', async () => { throw Error('offline failure'); });
  const { task } = await api.createInstantJob('u1', ticket.upload_id);
  now = new Date(now.getTime() + 61_000);
  const handler = createHandler({ service: api });
  for (let i = 0; i < 2; i++) {
    const response = await handler({ __http: true, method: 'GET', path: `/api/v1/instant-analysis/${task._id}` }, { auth: { uid: 'u1' } });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).status, 'queued');
  }
  assert.equal(dispatch.mock.callCount(), 2);
});

test('existing queued creation re-dispatches after 60s and always keeps created false', async t => {
  let now = new Date('2026-09-12T00:00:00Z');
  const { api, ticket, repo } = await readyUpload(() => now);
  let fail = false;
  const dispatch = t.mock.method(dispatchModule, 'dispatchAnalysis', async () => { if (fail) throw Error('offline failure'); return 'offline'; });
  const { task } = await api.createInstantJob('u1', ticket.upload_id);
  now = new Date(task.created_at.getTime() + 60_000);
  assert.equal((await api.createInstantJob('u1', ticket.upload_id)).created, false);
  assert.equal(dispatch.mock.callCount(), 0);
  now = new Date(task.created_at.getTime() + 61_000);
  for (const shouldFail of [false, true]) {
    fail = shouldFail;
    const result = await api.createInstantJob('u1', ticket.upload_id);
    assert.equal(result.created, false); assert.equal(result.task._id, task._id);
  }
  assert.equal(dispatch.mock.callCount(), 2);
  for (const status of ['running', 'succeeded', 'failed'] as const) {
    repo.tasks.set(task._id, { ...task, status });
    assert.equal((await api.createInstantJob('u1', ticket.upload_id)).created, false);
  }
  assert.equal(dispatch.mock.callCount(), 2);
});

test('demo model and demo text are blocked before polling dispatch without mutating storage', async t => {
  const { api, ticket, repo } = await readyUpload();
  const dispatch = t.mock.method(dispatchModule, 'dispatchAnalysis', async () => 'offline');
  const { task } = await api.createInstantJob('u1', ticket.upload_id);
  for (const text_result of [{ model: 'demo', content: '8.1' }, { model: 'qwen', content: '演示数据：8.1' }]) {
    const stored: TaskRecord = { ...task, created_at: new Date(task.created_at.getTime() - 61_000), text_result };
    repo.tasks.set(task._id, stored);
    const result = await api.taskForUser('u1', task._id);
    assert.equal(result.error?.code, 'LEGACY_DEMO_RESULT');
    assert.equal(result.status, 'failed'); assert.equal(result.text_result, undefined);
    assert.equal(stored.text_result, text_result);
  }
  assert.equal(dispatch.mock.callCount(), 0);
});

test('unfinished pre-RC instant tasks are rejected while terminal history stays readable', async t => {
  const { api, ticket, repo } = await readyUpload();
  const dispatch = t.mock.method(dispatchModule, 'dispatchAnalysis', async () => 'offline');
  const { task } = await api.createInstantJob('u1', ticket.upload_id);
  const legacyId = `instant_${ticket.upload_id}`;
  for (const status of ['queued', 'running', 'succeeded', 'failed'] as const) {
    repo.tasks.set(legacyId, { ...task, _id: legacyId, status });
    const result = await api.taskForUser('u1', legacyId);
    if (status === 'queued' || status === 'running') assert.equal(result.error?.code, 'LEGACY_TASK_REANALYSIS_REQUIRED');
    else { assert.equal(result.status, status); assert.equal(result.error, undefined); }
  }
  assert.equal(dispatch.mock.callCount(), 0);
});

test('RC identity is idempotent and separates mode, context and explicit reanalysis', async () => {
  const { api, ticket } = await readyUpload();
  const first = await api.createInstantJob('u1', ticket.upload_id, undefined, { team_name: ' red ' });
  const same = await api.createInstantJob('u1', ticket.upload_id, undefined, { team_name: 'red' });
  assert.match(first.task._id, /^rc_[a-f0-9]{64}$/);
  assert.equal(first.task.upload_id, ticket.upload_id);
  assert.equal(first.created, true); assert.equal(same.created, false);
  assert.equal(first.task._id, same.task._id);
  const personal = await api.createInstantJob('u1', ticket.upload_id, undefined, { analysis_mode: 'personal_match', target_description: 'red 10' });
  assert.notEqual(first.task._id, personal.task._id);
  const retry = await api.createInstantJob('u1', ticket.upload_id, undefined, { team_name: 'red' }, { reanalysisKey: 'retry_1234567890123456' });
  assert.notEqual(first.task._id, retry.task._id);
});

test('SDK envelope keeps POST, dispatches exactly once, and failed dispatch returns 202', async () => {
  const { api, ticket, repo } = await readyUpload(); let calls = 0;
  const handler = createHandler({ service: api, dispatch: async () => { calls++; throw Error('offline dispatch'); } });
  const event = { __http: true, method: 'POST', path: '/api/v1/instant-analysis', body: { upload_id: ticket.upload_id, analysis_context: { analysis_mode: 'personal_match', target_description: 'red 10' } } };
  const context = { auth: { uid: 'u1' } };
  const first = await handler(event, context);
  assert.equal(first.statusCode, 202);
  const body = JSON.parse(first.body);
  assert.equal(body.warning.code, 'DISPATCH_PENDING');
  assert.equal(repo.tasks.get(body.job_id)!.analysis_context!.target_description, 'red 10');
  assert.equal((await handler(event, context)).statusCode, 202);
  assert.equal(calls, 1);
  const read = await handler({ __http: true, method: 'GET', path: `/api/v1/instant-analysis/${body.job_id}` }, context);
  assert.equal(read.statusCode, 200); assert.equal(calls, 1);
  assert.equal((await handler({ __http: true, method: 'POST', path: event.path, body: '{' }, context)).statusCode, 400);
});

test('worker authorization requires both token and expected environment', () => {
  assert.throws(() => requireWorker({ headers: {} }, 'secret', 'test'), /invalid worker identity/);
  assert.throws(() => requireWorker({ headers: { authorization: 'Bearer secret' } }, 'secret', 'test'), /environment/);
  assert.doesNotThrow(() => requireWorker({ headers: { authorization: 'Bearer secret', 'x-cloudbase-env': 'test' } }, 'secret', 'test'));
});

test('RC repository uses RC keys for lookup, references, TTL and deletion', async () => {
  const { api, ticket } = await readyUpload();
  const { task } = await api.createInstantJob('u1', ticket.upload_id);
  const records = new Map<string, TaskRecord>([[`db/rc_task/${task._id}.json`, task]]);
  const removed: string[] = [];
  const store = {
    getJson: async (key: string) => records.has(key) ? { data: records.get(key) } : null,
    listKeys: async (prefix: string) => [...records.keys()].filter(k => k.startsWith(prefix)),
    deleteObject: async (key: string) => { removed.push(key); records.delete(key); }
  };
  const repository = new RcRepository(store as any);
  repository.rc = () => ({
    get: async (id: string) => records.get(`db/rc_task/${id}.json`) || null,
    mutate: async (id: string, fn: any) => { const r = fn(records.get(`db/rc_task/${id}.json`)); if(r.value) records.set(`db/rc_task/${id}.json`, r.value); return r.result; }
  });
  const previous = process.env.TASK_STORAGE; process.env.TASK_STORAGE = 'cos-cas';
  try {
    assert.equal((await repository.getTask(task._id))!._id, task._id);
    assert.equal((await repository.findTasksByInputKey(task.input_object_key)).length, 1);
    assert.equal((await repository.expireTaskIfStale(task._id, new Date('2026-09-12T01:00:00Z'), 1800))!.status, 'failed');
    await assert.rejects(repository.saveInstantResult(), /fenced worker lease/);
    await repository.deleteTask(task._id);
    assert.deepEqual(removed, [`db/rc_task/${task._id}.json`]);
  } finally { if(previous === undefined) delete process.env.TASK_STORAGE; else process.env.TASK_STORAGE = previous; }
});

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

test("upload matches online permissive media acceptance and server-generates keys", async () => {
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => new Date("2026-08-24T00:00:00Z"));
  const large = await api.issueUpload("u1", { filename: "a.webm", content_type: "application/octet-stream", size_bytes: config.maxUploadBytes + 1, duration_seconds: 901 });
  assert.match(large.upload_url, /source\.webm/);
  await assert.rejects(api.issueUpload("u1", { size_bytes: 0, duration_seconds: 10 }), /必须为正数/);
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
  const { task: instantTask } = await api.createInstantJob("u1", uploadId);
  const { task: personalTask } = await repo.createInstantTask({
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
  const { task: created } = await api.createInstantJob("u1", uploadId);

  // 刚入队：未超时应保持 queued，不能被误判
  const fresh = await api.taskForUser("u1", created._id);
  assert.equal(fresh.status, "queued");

  // 超过 TTL 仍无人领取 → 判为失败，前端才会停止轮询
  current = new Date(current.getTime() + (config.queuedTtlSeconds + 60) * 1000);
  const stale = await api.taskForUser("u1", created._id);
  assert.equal(stale.status, "failed");
  assert.equal(stale.error && stale.error.code, "STALE_QUEUED");
});
