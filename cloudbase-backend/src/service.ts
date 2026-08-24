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
    if (size > this.config.maxUploadBytes) throw new ApiError(413, "VIDEO_TOO_LARGE", "视频不得超过 300MB");
    if (duration > this.config.maxDurationSeconds) throw new ApiError(422, "VIDEO_TOO_LONG", "视频不得超过 15 分钟");
    if (!["video/mp4", "video/quicktime"].includes(contentType)) throw new ApiError(415, "UNSUPPORTED_VIDEO", "仅支持 MP4/MOV");
    const uploadId = id("task");
    const inputKey = `inputs/${ownerId}/${uploadId}/source${safeExtension(filename)}`;
    const outputKey = `outputs/${ownerId}/${uploadId}/annotated.mp4`;
    const created = this.now();
    const upload: UploadRecord = {
      _id: uploadId, owner_id: ownerId, input_object_key: inputKey, output_object_key: outputKey,
      original_filename: filename, content_type: contentType, expected_size_bytes: size,
      duration_seconds: duration, client_match_id: body.client_match_id ? String(body.client_match_id).slice(0, 128) : undefined,
      status: "pending", created_at: created, expires_at: new Date(created.getTime() + this.config.uploadUrlSeconds * 1000)
    };
    await this.repo.createUpload(upload);
    return {
      upload_id: uploadId, object_key: inputKey,
      upload: { method: "PUT", url: await this.objects.signedPutUrl(inputKey, this.config.uploadUrlSeconds), expires_at: upload.expires_at.toISOString() },
      limits: { max_size_bytes: this.config.maxUploadBytes, max_duration_seconds: this.config.maxDurationSeconds }
    };
  }

  async confirmUpload(ownerId: string, uploadId: string): Promise<TaskRecord> {
    const upload = await this.repo.getUpload(uploadId);
    if (!upload || upload.owner_id !== ownerId) throw new ApiError(404, "UPLOAD_NOT_FOUND", "上传记录不存在");
    const existing = await this.repo.getTask(uploadId);
    if (existing) return existing;
    if (new Date(upload.expires_at).getTime() <= this.now().getTime()) throw new ApiError(409, "UPLOAD_EXPIRED", "上传票据已过期");
    const metadata = await this.objects.head(upload.input_object_key);
    if (metadata.sizeBytes !== upload.expected_size_bytes) throw new ApiError(409, "UPLOAD_SIZE_MISMATCH", "上传对象大小与申请不一致");
    const now = this.now();
    const task: TaskRecord = {
      _id: upload._id, owner_id: ownerId, client_match_id: upload.client_match_id,
      status: "queued", stage: "queued", progress: 0,
      input_object_key: upload.input_object_key, output_object_key: upload.output_object_key,
      input: { filename: upload.original_filename, content_type: upload.content_type, size_bytes: metadata.sizeBytes, duration_seconds: upload.duration_seconds },
      raw_lifecycle: { delete_after: addDays(now, this.config.rawRetentionDays) },
      result_lifecycle: {}, attempt: 0, max_attempts: 3, available_at: now, created_at: now, updated_at: now
    };
    return this.repo.confirmUpload(upload, task);
  }

  async taskForUser(ownerId: string, taskId: string): Promise<TaskRecord> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.owner_id !== ownerId) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    return task;
  }
  async resultUrl(ownerId: string, taskId: string) {
    const task = await this.taskForUser(ownerId, taskId);
    if (task.status !== "succeeded" || !task.output) throw new ApiError(409, "RESULT_NOT_READY", "检测结果尚未生成");
    return { url: await this.objects.signedGetUrl(task.output.object_key, this.config.resultUrlSeconds), expires_in: this.config.resultUrlSeconds };
  }
  async claim(body: any) {
    const workerId = String(body.worker_id || "");
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(workerId)) throw new ApiError(400, "INVALID_WORKER_ID", "worker_id is invalid");
    const leaseSeconds = Math.min(number(body.lease_seconds, "lease_seconds"), this.config.maxLeaseSeconds);
    return this.repo.claim(workerId, leaseSeconds, this.now());
  }
  renew(body: any) { return this.repo.renew(String(body.task_id), String(body.lease_token), Math.min(number(body.lease_seconds, "lease_seconds"), this.config.maxLeaseSeconds), this.now()); }
  progress(body: any) {
    const progress = Number(body.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 99) throw new ApiError(400, "INVALID_PROGRESS", "progress must be between 0 and 99");
    const stages = ["probing", "detecting", "rendering"];
    if (!stages.includes(body.stage)) throw new ApiError(400, "INVALID_STAGE", "stage is invalid");
    return this.repo.progress(String(body.task_id), String(body.lease_token), { progress, stage: body.stage, eta_seconds: body.eta_seconds == null ? null : Math.max(0, Number(body.eta_seconds)) }, this.now());
  }
  complete(body: any) {
    if (!body.idempotency_key || String(body.idempotency_key).length > 128) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "idempotency_key is required");
    const output = body.output || {};
    return this.repo.getTask(String(body.task_id)).then((task) => {
      if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
      if (String(output.object_key) !== task.output_object_key) throw new ApiError(400, "INVALID_OUTPUT_KEY", "output object key does not match task assignment");
      const now = this.now();
      return this.repo.complete(task._id, String(body.lease_token), String(body.idempotency_key), {
        output: { object_key: task.output_object_key, etag: String(output.etag || ""), size_bytes: number(output.size_bytes, "output.size_bytes") },
        diagnostics: body.diagnostics, warnings: Array.isArray(body.warnings) ? body.warnings.slice(0, 20).map(String) : [], model: body.model,
        result_lifecycle: { delete_after: addDays(now, this.config.resultRetentionDays) }
      }, now);
    });
  }
  fail(body: any) {
    const error = body.error || {};
    if (!error.code || !error.message) throw new ApiError(400, "INVALID_ERROR", "error.code and error.message are required");
    return this.repo.fail(String(body.task_id), String(body.lease_token), body.retryable === true,
      { code: String(error.code).slice(0, 64), message: String(error.message).slice(0, 500) }, this.now());
  }
}
