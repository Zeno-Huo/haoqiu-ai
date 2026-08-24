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
  expires_at: Date;
}

export interface TaskRecord {
  _id: string;
  owner_id: string;
  client_match_id?: string;
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
