import { CosRepository } from './cos-repository';
import { ApiError, type TaskRecord } from './types';

// Resolved from dist/src at runtime; API and VLM share the original task store.
const { configuredStore } = require('../../haoqiu-vlm/task-store');

export class RcRepository extends CosRepository {
  rc() { return configuredStore(); }
  async getTask(id: string): Promise<TaskRecord | null> {
    return id.startsWith('rc_') ? this.rc().get(id) : super.getTask(id);
  }
  async createInstantTask(task: TaskRecord): Promise<{ task: TaskRecord; created: boolean }> {
    return this.rc().create(task);
  }
  async saveInstantResult(): Promise<TaskRecord> {
    throw new ApiError(409, 'LEASE_REQUIRED', 'Instant results require a fenced worker lease');
  }

  // Keep main's history deletion and queued TTL compatible with the RC prefix.
  async deleteTask(id: string): Promise<void> {
    if (!id.startsWith('rc_')) return super.deleteTask(id);
    if (process.env.TASK_STORAGE !== 'cos-cas') throw new ApiError(503, 'CONFIGURATION_ERROR', 'RC 删除仅支持当前 COS 存储');
    await this.store.deleteObject(`db/rc_task/${id}.json`);
  }
  async findTasksByInputKey(key: string): Promise<TaskRecord[]> {
    if (process.env.TASK_STORAGE !== 'cos-cas') throw new ApiError(503, 'CONFIGURATION_ERROR', 'RC 引用检查仅支持当前 COS 存储');
    const found = await super.findTasksByInputKey(key);
    // Deletion must examine every page; the recovery store's capped scan is unsuitable.
    for (const objectKey of await this.store.listKeys('db/rc_task/', Number.MAX_SAFE_INTEGER)) {
      const record = await this.store.getJson<TaskRecord>(objectKey);
      if (record?.data.input_object_key === key) found.push(record.data);
    }
    return found;
  }
  async expireTaskIfStale(id: string, now: Date, ttl: number): Promise<TaskRecord | null> {
    if (!id.startsWith('rc_')) return super.expireTaskIfStale(id, now, ttl);
    return this.rc().mutate(id, (task: TaskRecord | null) => {
      if (!task || !['queued', 'retry_wait'].includes(task.status) || new Date(task.created_at).getTime() > now.getTime() - ttl * 1000) return { result: task };
      const value = { ...task, status: 'failed', stage: 'failed', updated_at: now, completed_at: now,
        error: { code: 'STALE_QUEUED', message: '任务排队超时，VLM 未返回结果' } };
      return { value, result: value };
    });
  }
}
