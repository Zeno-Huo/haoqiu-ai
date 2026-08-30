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
        // 即时分析(instant)只走 haoqiu-vlm 云函数，禁止 HAI GPU worker 领取，避免重复处理/竞态。
        if (t.mode === "instant") return false;
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

  async deleteTask(id: string): Promise<void> {
    await this.store.deleteObject(taskKey(id));
  }
  async deleteUpload(id: string): Promise<void> {
    await this.store.deleteObject(uploadKey(id));
  }
  /** 找出仍引用同一段原始视频的任务。
   *  key 形如 inputs/{ownerId}/{uploadId}/source.mp4，而 uploadId 唯一，
   *  同一段视频最多派生出 deep(<uploadId>) 与 instant(instant_<uploadId>) 两个任务，
   *  因此直接按 key 精确读取即可，不必全表扫描——listAllTasks 有 max 上限，
   *  任务量一大就会漏判引用，进而误删别的任务仍在使用的视频。 */
  async findTasksByInputKey(inputObjectKey: string): Promise<TaskRecord[]> {
    const match = inputObjectKey.match(/^inputs\/[^/]+\/([^/]+)\//);
    if (match) {
      const uploadId = match[1];
      const found: TaskRecord[] = [];
      for (const id of [uploadId, `instant_${uploadId}`]) {
        const task = await this.readTask(id);
        if (task && task.input_object_key === inputObjectKey) found.push(task);
      }
      return found;
    }
    // 兜底：key 格式不符合预期时退回全表扫描（上限调大，尽量不漏）。
    const tasks = await this.listAllTasks(5000);
    return tasks.filter((t) => t.input_object_key === inputObjectKey);
  }

  /** 单个任务的排队超时判定：queued/retry_wait 且创建时间超过 TTL 则判失败并返回新记录，否则返回 null。
   *  背景：queued 任务此前没有超时上限，worker 不在线时 attempt 恒为 0、永远够不到 max_attempts，
   *  任务会永久停在队列里，前端持续轮询产生 COS 读请求费。
   *  刻意做成"按任务判定"而非遍历全表：遍历会让每次前端轮询都扫一遍所有任务，反而放大请求费。 */
  async expireTaskIfStale(taskId: string, now: Date, ttlSeconds: number): Promise<TaskRecord | null> {
    const task = await this.readTask(taskId);
    if (!task) return null;
    // 未命中过期条件时原样返回：调用方（前端轮询）直接复用这次读取，
    // 不必再读一遍 COS——轮询是高频操作，多一次读就是多一倍请求费。
    if (!["queued", "retry_wait"].includes(task.status)) return task;
    if (iso(task.created_at) > now.getTime() - ttlSeconds * 1000) return task;
    const failed: TaskRecord = {
      ...task,
      status: "failed",
      stage: "failed",
      updated_at: now,
      completed_at: now,
      error: { code: "STALE_QUEUED", message: "任务排队超时，未检测到可处理的工作节点" }
    };
    await this.writeTask(failed);
    return failed;
  }
}
