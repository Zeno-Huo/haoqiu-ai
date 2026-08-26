import crypto from "node:crypto";
import { ApiError } from "./types";
import type { TaskRepository } from "./repository";
import type { TaskRecord, UploadRecord } from "./types";
import type { TencentCosStore } from "./cos";

const UPLOAD_PREFIX = "db/upload/";
const TASK_PREFIX = "db/task/";

const uploadKey = (id: string): string => `${UPLOAD_PREFIX}${id}.json`;
const taskKey = (id: string): string => `${TASK_PREFIX}${id}.json`;

const iso = (d: Date | string | undefined | null): number => (d ? new Date(d).getTime() : 0);

/** 基于 COS 的 JSON 文件存储，替代 node-sdk 文档库（该体验版环境文档库 API 不可用）。 */
export class CosRepository implements TaskRepository {
  constructor(private store: TencentCosStore) {}

  private async readUpload(id: string): Promise<UploadRecord | null> {
    const r = await this.store.getJson<UploadRecord>(uploadKey(id));
    return r ? (r.data as UploadRecord) : null;
  }
  private async writeUpload(record: UploadRecord): Promise<void> {
    await this.store.putJson(uploadKey(record._id), record);
  }
  private async readTask(id: string): Promise<TaskRecord | null> {
    const r = await this.store.getJson<TaskRecord>(taskKey(id));
    return r ? (r.data as TaskRecord) : null;
  }
  private async writeTask(record: TaskRecord): Promise<void> {
    await this.store.putJson(taskKey(record._id), record);
  }
  private async listAllTasks(max = 500): Promise<TaskRecord[]> {
    const keys = await this.store.listKeys(TASK_PREFIX, max);
    const tasks: TaskRecord[] = [];
    for (const key of keys) {
      const id = key.slice(TASK_PREFIX.length).replace(/\.json$/, "");
      const t = await this.readTask(id);
      if (t) tasks.push(t);
    }
    return tasks;
  }

  async createUpload(upload: UploadRecord): Promise<void> { await this.writeUpload(upload); }
  async getUpload(id: string): Promise<UploadRecord | null> { return this.readUpload(id); }
  async getTask(id: string): Promise<TaskRecord | null> { return this.readTask(id); }

  async confirmUpload(upload: UploadRecord, task: TaskRecord): Promise<TaskRecord> {
    const existing = await this.readTask(task._id);
    if (existing) return existing;
    const current = await this.readUpload(upload._id);
    if (!current || current.owner_id !== upload.owner_id) throw new ApiError(404, "UPLOAD_NOT_FOUND", "上传记录不存在");
    if (iso(current.pending_expires_at) <= Date.now()) throw new ApiError(409, "UPLOAD_EXPIRED", "待确认上传记录已过期");
    await this.writeTask(task);
    await this.writeUpload({ ...current, status: "confirmed", confirmed_at: task.created_at });
    return task;
  }

  async claim(workerId: string, leaseSeconds: number, now: Date): Promise<TaskRecord | null> {
    const nowMs = now.getTime();
    const tasks = await this.listAllTasks();
    const eligible = tasks
      .filter((t) => {
        const status = t.status;
        const availableAt = iso(t.available_at);
        const leaseExpiresAt = iso(t.lease_expires_at);
        if (["queued", "retry_wait"].includes(status) && availableAt <= nowMs) return true;
        if (["leased", "running"].includes(status) && leaseExpiresAt <= nowMs) return true;
        return false;
      })
      .sort((a, b) => iso(a.created_at) - iso(b.created_at));
    const task = eligible[0];
    if (!task) return null;
    if (task.attempt >= task.max_attempts) {
      const failed: TaskRecord = {
        ...task,
        status: "failed", stage: "failed",
        updated_at: now, completed_at: now,
        error: { code: "MAX_ATTEMPTS_EXCEEDED", message: "任务重试次数已耗尽" }
      };
      await this.writeTask(failed);
      return null;
    }
    const leaseToken = crypto.randomBytes(32).toString("base64url");
    const updated: TaskRecord = {
      ...task,
      status: "leased",
      stage: task.stage === "queued" ? "queued" : task.stage,
      lease_token: leaseToken,
      lease_owner: workerId,
      lease_expires_at: new Date(nowMs + leaseSeconds * 1000),
      attempt: task.attempt + 1,
      updated_at: now
    };
    await this.writeTask(updated);
    return updated;
  }

  private async leaseMutation(taskId: string, token: string, now: Date, mutate: (task: TaskRecord) => Partial<TaskRecord>): Promise<TaskRecord> {
    const task = await this.readTask(taskId);
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    if (!["leased", "running"].includes(task.status) || task.lease_token !== token || iso(task.lease_expires_at) <= now.getTime()) {
      throw new ApiError(409, "LEASE_LOST", "任务租约已失效");
    }
    const patch = mutate(task);
    const updated: TaskRecord = { ...task, ...patch };
    await this.writeTask(updated);
    return updated;
  }

  renew(taskId: string, token: string, leaseSeconds: number, now: Date): Promise<TaskRecord> {
    return this.leaseMutation(taskId, token, now, () => ({ lease_expires_at: new Date(now.getTime() + leaseSeconds * 1000), updated_at: now }));
  }
  progress(taskId: string, token: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord> {
    return this.leaseMutation(taskId, token, now, (task) => ({ ...patch, status: "running", started_at: task.started_at || now, updated_at: now }));
  }

  async complete(taskId: string, token: string, idempotencyKey: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord> {
    const task = await this.readTask(taskId);
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    if (task.status === "succeeded") {
      if (task.idempotency_key === idempotencyKey) return task;
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "任务已由其他幂等键完成");
    }
    if (task.lease_token !== token || iso(task.lease_expires_at) <= now.getTime()) throw new ApiError(409, "LEASE_LOST", "任务租约已失效");
    const updated: TaskRecord = {
      ...task, ...patch,
      status: "succeeded", stage: "completed", progress: 100,
      idempotency_key: idempotencyKey, completed_at: now, updated_at: now
    };
    await this.writeTask(updated);
    return updated;
  }

  fail(taskId: string, token: string, retryable: boolean, error: { code: string; message: string }, now: Date): Promise<TaskRecord> {
    return this.leaseMutation(taskId, token, now, (task) => {
      const retry = retryable && task.attempt < task.max_attempts;
      const update: Partial<TaskRecord> = {
        status: retry ? "retry_wait" : "failed",
        stage: retry ? "queued" : "failed",
        error,
        available_at: new Date(now.getTime() + Math.min(300, 2 ** task.attempt * 5) * 1000),
        updated_at: now
      };
      if (!retry) update.completed_at = now;
      return update;
    });
  }

  async createInstantTask(task: TaskRecord): Promise<TaskRecord> {
    await this.writeTask(task);
    return task;
  }

  async saveInstantResult(taskId: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord> {
    const task = await this.readTask(taskId);
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    const update: Partial<TaskRecord> = { ...patch, updated_at: now };
    if (patch.status === "succeeded" && !task.completed_at) update.completed_at = now;
    const updated: TaskRecord = { ...task, ...update };
    await this.writeTask(updated);
    return updated;
  }
}
