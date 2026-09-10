import crypto from "node:crypto";
import path from "node:path";
import type { Config } from "./config";
import type { ObjectStore } from "./cos";
import type { TaskRepository } from "./repository";
import { ApiError } from "./types";
import type { TaskRecord, UploadRecord } from "./types";

const id = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(10).toString("hex")}`;
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86400_000);
const safeExtension = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  return [".mp4", ".mov"].includes(ext) ? ext : ".mp4";
};
const number = (value: unknown, field: string): number => {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new ApiError(400, "INVALID_INPUT", `${field} 必须为正数`);
  return result;
};

export class TaskService {
  constructor(private repo: TaskRepository, private objects: ObjectStore, private config: Config, private now = () => new Date()) {}

  async issueUpload(ownerId: string, body: any) {
    const filename = String(body.filename || "video.mp4").slice(0, 255);
    const contentType = String(body.content_type || "video/mp4").toLowerCase();
    const size = number(body.size_bytes, "size_bytes");
    const duration = number(body.duration_seconds, "duration_seconds");
    if (size > this.config.maxUploadBytes) throw new ApiError(413, "VIDEO_TOO_LARGE", "视频不得超过 1GB");
    if (duration > this.config.maxDurationSeconds) throw new ApiError(422, "VIDEO_TOO_LONG", "视频不得超过 20 分钟");
    if (!["video/mp4", "video/quicktime"].includes(contentType)) throw new ApiError(415, "UNSUPPORTED_VIDEO", "仅支持 MP4/MOV");
    const uploadId = id("task");
    const inputKey = `inputs/${ownerId}/${uploadId}/source${safeExtension(filename)}`;
    const created = this.now();
    const ticketExpiresAt = new Date(created.getTime() + this.config.uploadUrlSeconds * 1000);
    const upload: UploadRecord = {
      _id: uploadId, owner_id: ownerId, input_object_key: inputKey,
      original_filename: filename, content_type: contentType, expected_size_bytes: size,
      duration_seconds: duration, client_match_id: body.client_match_id ? String(body.client_match_id).slice(0, 128) : undefined,
      status: "pending", created_at: created, ticket_expires_at: ticketExpiresAt,
      pending_expires_at: new Date(created.getTime() + this.config.pendingUploadSeconds * 1000)
    };
    await this.repo.createUpload(upload);
    return {
      upload_id: uploadId,
      method: "PUT" as const,
      upload_url: await this.objects.signedPutUrl(inputKey, this.config.uploadUrlSeconds),
      headers: {},
      expires_at: ticketExpiresAt.toISOString(),
      max_size_bytes: this.config.maxUploadBytes
    };
  }

  async taskForUser(ownerId: string, taskId: string): Promise<TaskRecord> {
    // 超时判定与读取合并为一次：既省掉一次 COS 读请求（轮询是高频操作），又不需要额外定时触发器。
    // 背景：worker 不在线时 queued 任务会永远停着（attempt 恒为 0），前端无限轮询产生 COS 读请求费。
    let task: TaskRecord | null;
    try {
      task = await this.repo.expireTaskIfStale(taskId, this.now(), this.config.queuedTtlSeconds);
    } catch {
      // 超时判定是旁路逻辑，失败后退化为普通读取，不能阻塞正常查询。
      task = await this.repo.getTask(taskId);
    }
    if (!task || task.owner_id !== ownerId) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    return task;
  }

  /** 即时分析(VLM)：基于已上传的视频创建任务，由 haoqiu-vlm 云函数异步处理。
   *  团队比赛用 instant_<uploadId>，个人比赛用 <uploadId>，两者 id 隔离、互不覆盖。 */
  async createInstantJob(ownerId: string, uploadId: string, clientMatchId?: string, analysisContext?: TaskRecord["analysis_context"]): Promise<TaskRecord> {
    const upload = await this.repo.getUpload(uploadId);
    if (!upload || upload.owner_id !== ownerId) throw new ApiError(404, "UPLOAD_NOT_FOUND", "上传记录不存在");
    const instantId = `instant_${uploadId}`;
    const existing = await this.repo.getTask(instantId);
    if (existing) return existing;

    // 上传完成校验：原先由 confirmUpload（GPU 链路）负责，砍掉 YOLO 后必须在这里补上。
    // 否则用户视频还没传完就点分析，VLM 会拿到残缺文件、产出无意义的结果。
    if (new Date(upload.pending_expires_at).getTime() <= this.now().getTime()) {
      throw new ApiError(409, "UPLOAD_EXPIRED", "上传记录已过期，请重新上传视频");
    }
    const metadata = await this.objects.head(upload.input_object_key);
    if (metadata.sizeBytes !== upload.expected_size_bytes) {
      throw new ApiError(409, "UPLOAD_SIZE_MISMATCH", "视频尚未上传完成，请等待上传结束后再分析");
    }

    const now = this.now();
    const task: TaskRecord = {
      _id: instantId, owner_id: ownerId, client_match_id: upload.client_match_id || clientMatchId,
      mode: "instant", analysis_context: analysisContext, status: "queued", stage: "queued", progress: 0,
      input_object_key: upload.input_object_key,
      input: { filename: upload.original_filename, content_type: upload.content_type, size_bytes: metadata.sizeBytes, duration_seconds: upload.duration_seconds },
      raw_lifecycle: { delete_after: addDays(now, this.config.rawRetentionDays) },
      created_at: now, updated_at: now
    };
    return this.repo.createInstantTask(task);
  }

  /** 由 haoqiu-vlm 回写文字事件总结。 */
  async completeInstant(taskId: string, content: string, model?: string): Promise<TaskRecord> {
    return this.repo.saveInstantResult(taskId, {
      status: "succeeded", stage: "completed", progress: 100,
      text_result: { content, model, generated_at: new Date().toISOString() }
    }, this.now());
  }
  async failInstant(taskId: string, code: string, message: string): Promise<TaskRecord> {
    return this.repo.saveInstantResult(taskId, { status: "failed", stage: "failed", error: { code, message } }, this.now());
  }
  /** 删除任务并释放它占用的 COS 存储。
   *  网页端删除必须走这里：此前 History 只删 localStorage 记录，云端任务 JSON 与视频永不释放，
   *  导致每次测试上传的视频都永久堆积在桶里。
   *  注意同一段上传视频可能同时挂着团队与个人两个任务，因此只有确认没有其他任务仍引用时才删源文件。 */
  async deleteTaskForUser(ownerId: string, taskId: string): Promise<{ task_id: string; deleted_objects: string[]; kept_objects: string[] }> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.owner_id !== ownerId) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");

    const deleted: string[] = [];
    const kept: string[] = [];
    // 砍掉 YOLO 后不再有标注视频（output_object_key），只回收原始上传视频。
    const keys = [task.input_object_key].filter((k): k is string => Boolean(k));

    // 引用检查必须在删除自身之前完成，并显式排除自身：
    // 若依赖"先删自己再查表"的隐式顺序，一旦有人调整顺序，判断就会把自己也算作引用方，导致永远不放行删视频。
    const siblings = (await this.repo.findTasksByInputKey(task.input_object_key)).filter((t) => t._id !== taskId);

    if (siblings.length > 0) {
      // 同一段视频还有别的任务在用（团队 + 个人并存），只删任务记录、保留视频文件。
      await this.repo.deleteTask(taskId);
      kept.push(...keys);
      return { task_id: taskId, deleted_objects: deleted, kept_objects: kept };
    }

    // 先删视频、后删任务：删视频失败时任务记录仍在，用户可以重试删除；
    // 反过来的话会留下"任务已删、视频成孤儿、而接口再也触发不到清理"的死角。
    // 失败直接抛出（COS 对不存在的对象返回成功，这里失败通常是网络/权限问题，值得让用户重试）。
    for (const key of keys) {
      await this.objects.deleteObject(key);
      deleted.push(key);
    }
    await this.repo.deleteTask(taskId);
    // 上传记录：instant 任务 id 形如 instant_<uploadId>，deep 任务 id 即 uploadId。
    const uploadId = task._id.startsWith("instant_") ? task._id.slice("instant_".length) : task._id;
    try { await this.repo.deleteUpload(uploadId); } catch { /* 上传记录可能本就不存在，不影响主体结果 */ }
    return { task_id: taskId, deleted_objects: deleted, kept_objects: kept };
  }
}
