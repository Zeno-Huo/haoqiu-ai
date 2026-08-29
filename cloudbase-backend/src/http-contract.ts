import type { TaskRecord } from "./types";

export const publicTask = (task: TaskRecord) => ({
  job_id: task._id,
  client_match_id: task.client_match_id,
  mode: task.mode,
  status: ["leased", "retry_wait"].includes(task.status) ? "queued" : task.status,
  progress: task.progress,
  stage: task.stage,
  input: task.input,
  model: task.model,
  diagnostics: task.diagnostics,
  events: task.events,
  training: task.training,
  warnings: task.warnings,
  error: task.error,
  text_result: task.text_result,
  artifacts: { annotated_video_ready: task.status === "succeeded" && Boolean(task.output) },
  created_at: task.created_at,
  started_at: task.started_at,
  completed_at: task.completed_at
});

type ClaimedTask = TaskRecord & {
  input_download_url?: string;
  output_upload_url?: string;
  signed_url_expires_at?: string;
};

export const workerTask = (task: ClaimedTask | null) => task && ({
  task_id: task._id, lease_token: task.lease_token, lease_expires_at: task.lease_expires_at,
  input_object_key: task.input_object_key, output_object_key: task.output_object_key,
  client_match_id: task.client_match_id, attempt: task.attempt, max_attempts: task.max_attempts,
  input_download_url: task.input_download_url, output_upload_url: task.output_upload_url,
  signed_url_expires_at: task.signed_url_expires_at,
  input: task.input, status: task.status, progress: task.progress, stage: task.stage,
  analysis_context: task.analysis_context
});

export const haiCompletionBody = (taskId: string, body: any, idempotencyKey?: string) => {
  const result = body?.result || {};
  const detection = result.detection || {};
  return {
    task_id: taskId,
    lease_token: body?.lease_token,
    idempotency_key: idempotencyKey,
    output: result.artifact,
    diagnostics: detection.diagnostics,
    warnings: detection.warnings,
    model: result.model
  };
};
