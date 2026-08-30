import type { TaskRecord } from "./types";

export const publicTask = (task: TaskRecord) => ({
  job_id: task._id,
  client_match_id: task.client_match_id,
  mode: task.mode,
  status: task.status,
  progress: task.progress,
  stage: task.stage,
  input: task.input,
  error: task.error,
  text_result: task.text_result,
  created_at: task.created_at,
  started_at: task.started_at,
  completed_at: task.completed_at
});

// 砍掉 YOLO / HAI worker 后，不再需要「已领取任务」响应契约与 HAI 完成回传体构造。
