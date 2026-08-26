export type TaskStatus = "queued" | "leased" | "running" | "retry_wait" | "succeeded" | "failed";

export interface UploadRecord {
  _id: string;
  owner_id: string;
  input_object_key: string;
  output_object_key: string;
  original_filename: string;
  content_type: string;
  expected_size_bytes: number;
  duration_seconds: number;
  client_match_id?: string;
  status: "pending" | "confirmed";
  created_at: Date;
  ticket_expires_at: Date;
  pending_expires_at: Date;
  confirmed_at?: Date;
}

export interface TaskRecord {
  _id: string;
  owner_id: string;
  client_match_id?: string;
  /** 分析模式：instant = 即时分析(VLM 视频理解，快)；deep = 深度复盘(GPU 检测，慢) */
  mode?: "instant" | "deep";
  status: TaskStatus;
  stage: string;
  progress: number;
  input_object_key: string;
  output_object_key: string;
  input: { filename: string; content_type: string; size_bytes: number; duration_seconds: number };
  raw_lifecycle: { delete_after: Date; deleted_at?: Date };
  result_lifecycle: { delete_after?: Date; deleted_at?: Date };
  attempt: number;
  max_attempts: number;
  available_at: Date;
  lease_token?: string;
  lease_owner?: string;
  lease_expires_at?: Date;
  idempotency_key?: string;
  diagnostics?: unknown;
  warnings?: string[];
  model?: unknown;
  error?: { code: string; message: string };
  output?: { object_key: string; etag: string; size_bytes: number };
  /** 即时分析(VLM)产出的文字事件总结 */
  text_result?: { content: string; model?: string; generated_at?: string };
  eta_seconds?: number | null;
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

export interface ClaimRequest { worker_id: string; lease_seconds: number }
export interface LeaseRequest { task_id: string; lease_token: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
