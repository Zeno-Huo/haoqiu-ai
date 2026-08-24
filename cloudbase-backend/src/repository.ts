import crypto from "node:crypto";
import { ApiError } from "./types";
import type { TaskRecord, UploadRecord } from "./types";

export interface TaskRepository {
  createUpload(upload: UploadRecord): Promise<void>;
  getUpload(id: string): Promise<UploadRecord | null>;
  confirmUpload(upload: UploadRecord, task: TaskRecord): Promise<TaskRecord>;
  getTask(id: string): Promise<TaskRecord | null>;
  claim(workerId: string, leaseSeconds: number, now: Date): Promise<TaskRecord | null>;
  renew(taskId: string, token: string, leaseSeconds: number, now: Date): Promise<TaskRecord>;
  progress(taskId: string, token: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord>;
  complete(taskId: string, token: string, idempotencyKey: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord>;
  fail(taskId: string, token: string, retryable: boolean, error: { code: string; message: string }, now: Date): Promise<TaskRecord>;
}

const one = <T>(result: any): T | null => (result?.data?.[0] as T | undefined) || null;

export class CloudBaseRepository implements TaskRepository {
  constructor(private db: any) {}
  async createUpload(upload: UploadRecord): Promise<void> { await this.db.collection("haoqiu_uploads").add(upload); }
  async getUpload(id: string): Promise<UploadRecord | null> { return one(await this.db.collection("haoqiu_uploads").doc(id).get()); }
  async getTask(id: string): Promise<TaskRecord | null> { return one(await this.db.collection("haoqiu_detection_tasks").doc(id).get()); }

  async confirmUpload(upload: UploadRecord, task: TaskRecord): Promise<TaskRecord> {
    return this.db.runTransaction(async (tx: any) => {
      const existing = one<TaskRecord>(await tx.collection("haoqiu_detection_tasks").doc(task._id).get());
      if (existing) return existing;
      const current = one<UploadRecord>(await tx.collection("haoqiu_uploads").doc(upload._id).get());
      if (!current || current.owner_id !== upload.owner_id) throw new ApiError(404, "UPLOAD_NOT_FOUND", "上传记录不存在");
      if (current.expires_at.getTime() <= Date.now()) throw new ApiError(409, "UPLOAD_EXPIRED", "上传票据已过期");
      await tx.collection("haoqiu_detection_tasks").add(task);
      await tx.collection("haoqiu_uploads").doc(upload._id).update({ status: "confirmed", confirmed_at: task.created_at });
      return task;
    });
  }

  async claim(workerId: string, leaseSeconds: number, now: Date): Promise<TaskRecord | null> {
    const command = this.db.command;
    return this.db.runTransaction(async (tx: any) => {
      const eligible = command.or([
        { status: command.in(["queued", "retry_wait"]), available_at: command.lte(now) },
        { status: command.in(["leased", "running"]), lease_expires_at: command.lte(now) }
      ]);
      const result = await tx.collection("haoqiu_detection_tasks").where(eligible).orderBy("created_at", "asc").limit(1).get();
      const task = one<TaskRecord>(result);
      if (!task) return null;
      if (task.attempt >= task.max_attempts) {
        await tx.collection("haoqiu_detection_tasks").doc(task._id).update({
          status: "failed", stage: "failed", updated_at: now, completed_at: now,
          error: { code: "MAX_ATTEMPTS_EXCEEDED", message: "任务重试次数已耗尽" }
        });
        return null;
      }
      const leaseToken = crypto.randomBytes(32).toString("base64url");
      const updated: Partial<TaskRecord> = {
        status: "leased", stage: task.stage === "queued" ? "queued" : task.stage,
        lease_token: leaseToken, lease_owner: workerId,
        lease_expires_at: new Date(now.getTime() + leaseSeconds * 1000),
        attempt: task.attempt + 1, updated_at: now
      };
      await tx.collection("haoqiu_detection_tasks").doc(task._id).update(updated);
      return { ...task, ...updated } as TaskRecord;
    });
  }

  private async leaseMutation(taskId: string, token: string, now: Date, mutate: (task: TaskRecord) => Partial<TaskRecord>): Promise<TaskRecord> {
    return this.db.runTransaction(async (tx: any) => {
      const task = one<TaskRecord>(await tx.collection("haoqiu_detection_tasks").doc(taskId).get());
      if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
      if (!["leased", "running"].includes(task.status) || task.lease_token !== token || !task.lease_expires_at || new Date(task.lease_expires_at).getTime() <= now.getTime()) {
        throw new ApiError(409, "LEASE_LOST", "任务租约已失效");
      }
      const patch = mutate(task);
      await tx.collection("haoqiu_detection_tasks").doc(taskId).update(patch);
      return { ...task, ...patch } as TaskRecord;
    });
  }

  renew(taskId: string, token: string, leaseSeconds: number, now: Date): Promise<TaskRecord> {
    return this.leaseMutation(taskId, token, now, () => ({ lease_expires_at: new Date(now.getTime() + leaseSeconds * 1000), updated_at: now }));
  }
  progress(taskId: string, token: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord> {
    return this.leaseMutation(taskId, token, now, (task) => ({ ...patch, status: "running", started_at: task.started_at || now, updated_at: now }));
  }
  async complete(taskId: string, token: string, idempotencyKey: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord> {
    return this.db.runTransaction(async (tx: any) => {
      const task = one<TaskRecord>(await tx.collection("haoqiu_detection_tasks").doc(taskId).get());
      if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
      if (task.status === "succeeded") {
        if (task.idempotency_key === idempotencyKey) return task;
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "任务已由其他幂等键完成");
      }
      if (task.lease_token !== token || !task.lease_expires_at || new Date(task.lease_expires_at).getTime() <= now.getTime()) throw new ApiError(409, "LEASE_LOST", "任务租约已失效");
      const update: Partial<TaskRecord> = {
        ...patch, status: "succeeded", stage: "completed", progress: 100,
        idempotency_key: idempotencyKey, completed_at: now, updated_at: now
      };
      await tx.collection("haoqiu_detection_tasks").doc(taskId).update(update);
      return { ...task, ...update } as TaskRecord;
    });
  }
  fail(taskId: string, token: string, retryable: boolean, error: { code: string; message: string }, now: Date): Promise<TaskRecord> {
    return this.leaseMutation(taskId, token, now, (task) => {
      const retry = retryable && task.attempt < task.max_attempts;
      const update: Partial<TaskRecord> = {
        status: retry ? "retry_wait" : "failed", stage: retry ? "queued" : "failed", error,
        available_at: new Date(now.getTime() + Math.min(300, 2 ** task.attempt * 5) * 1000),
        updated_at: now
      };
      if (!retry) update.completed_at = now;
      return update;
    });
  }
}
