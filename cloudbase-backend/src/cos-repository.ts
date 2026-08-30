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
   *  同一段视频最多派生出个人(<uploadId>) 与团队(instant_<uploadId>) 两个任务，
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

  /** 排队超过 TTL 的任务判为失败。
   *  背景：任务此前没有超时上限，VLM 云函数若异常退出没回写结果，任务会永久停在 queued，
   *  前端持续轮询产生 COS 读请求费。
   *  刻意做成"按任务判定"而非遍历全表：遍历会让每次前端轮询都扫一遍所有任务，反而放大请求费。 */
  async expireTaskIfStale(taskId: string, now: Date, ttlSeconds: number): Promise<TaskRecord | null> {
    const task = await this.readTask(taskId);
    if (!task) return null;
    // 未命中过期条件时原样返回：调用方（前端轮询）直接复用这次读取，
    // 不必再读一遍 COS——轮询是高频操作，多一次读就是多一倍请求费。
    if (task.status !== "queued") return task;
    if (iso(task.created_at) > now.getTime() - ttlSeconds * 1000) return task;
    const failed: TaskRecord = {
      ...task,
      status: "failed",
      stage: "failed",
      updated_at: now,
      completed_at: now,
      error: { code: "STALE_QUEUED", message: "任务排队超时，VLM 未返回结果" }
    };
    await this.writeTask(failed);
    return failed;
  }
}
