import type { TaskRecord, UploadRecord } from "./types";

// 全面转向 VLM 后，任务只有「上传 -> VLM 云函数处理 -> 成功/失败」这一条链路，
// 不再有 worker 领取、租约、重试等中间态。
// 原 CloudBaseRepository（文档库实现）从未被使用——体验版环境文档库 API 不可用，
// 线上一直是 CosRepository（COS JSON 存储），故此处只保留接口，实现见 cos-repository.ts。
export interface TaskRepository {
  createUpload(upload: UploadRecord): Promise<void>;
  getUpload(id: string): Promise<UploadRecord | null>;
  getTask(id: string): Promise<TaskRecord | null>;
  createInstantTask(task: TaskRecord): Promise<TaskRecord>;
  saveInstantResult(taskId: string, patch: Partial<TaskRecord>, now: Date): Promise<TaskRecord>;
  /** 彻底删除任务 JSON（网页端删除必须走这里，否则只删浏览器本地记录、云端文件永存）。 */
  deleteTask(id: string): Promise<void>;
  deleteUpload(id: string): Promise<void>;
  /** 找出仍引用同一段原始视频的所有任务，用于判断视频能否安全删除。 */
  findTasksByInputKey(inputObjectKey: string): Promise<TaskRecord[]>;
  /** 单个任务的排队超时判定：queued/retry_wait 且超过 TTL 则标记为失败并返回新记录；
   *  未过期时原样返回任务本身（让调用方复用这次读取，避免二次读取把轮询请求费翻倍）；任务不存在才返回 null。
   *  刻意做成"按任务判定"而非遍历全表，避免每次前端轮询都扫一遍所有任务、反而放大 COS 读请求费。 */
  expireTaskIfStale(taskId: string, now: Date, ttlSeconds: number): Promise<TaskRecord | null>;
}
