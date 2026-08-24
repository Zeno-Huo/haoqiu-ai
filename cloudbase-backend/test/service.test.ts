import assert from "node:assert/strict";
import test from "node:test";
import { requireUser, requireWorker } from "../src/auth";
import { loadTencentCredentials } from "../src/config";
import type { Config } from "../src/config";
import type { ObjectMetadata, ObjectStore } from "../src/cos";
import type { TaskRepository } from "../src/repository";
import { TaskService } from "../src/service";
import { haiCompletionBody, publicTask } from "../src/http-contract";
import { ApiError } from "../src/types";
import type { TaskRecord, UploadRecord } from "../src/types";

class FakeObjects implements ObjectStore {
  metadata = new Map<string, ObjectMetadata>();
  async signedPutUrl(key: string) { return `https://upload.invalid/${key}?short-signature`; }
  async signedGetUrl(key: string) { return `https://download.invalid/${key}?short-signature`; }
  async head(key: string) { const value = this.metadata.get(key); if (!value) throw new ApiError(409, "UPLOAD_NOT_FOUND", "missing"); return value; }
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
}

const config: Config = {
  envId: "test", bucket: "haoqiu-ai-media-1352817304", region: "ap-shanghai",
  uploadUrlSeconds: 600, pendingUploadSeconds: 86400, resultUrlSeconds: 600, rawRetentionDays: 7, resultRetentionDays: 30,
  maxUploadBytes: 300 * 1024 * 1024, maxDurationSeconds: 900, maxLeaseSeconds: 120,
  workerToken: "worker-secret", allowTestIdentity: true
};

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

test("upload enforces 300MB and 15 minute boundaries and server-generates keys", async () => {
  const repo = new MemoryRepository(); const objects = new FakeObjects();
  const api = new TaskService(repo, objects, config, () => new Date("2026-08-24T00:00:00Z"));
  await assert.rejects(api.issueUpload("u1", { filename: "a.mp4", content_type: "video/mp4", size_bytes: config.maxUploadBytes + 1, duration_seconds: 10 }), /300MB/);
  await assert.rejects(api.issueUpload("u1", { filename: "a.mp4", content_type: "video/mp4", size_bytes: 100, duration_seconds: 901 }), /15 分钟/);
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
