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
  mode?: "instant" | "deep" | "single";
  analysis_context?: {
    team_name?: string;
    jersey_hint?: string;
    training_item?: string;
    opening_frame_point?: { x: number; y: number };
  };
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
  /** YOLO 事件统计（触球/传球/射门/抢断/控球率 + 真实主角）；HAI 未升级时为 undefined。 */
  events?: unknown;
  /** 个人训练专项指标（按 training_item 返回）；HAI 未升级时为 undefined。 */
  training?: unknown;
  /** 即时分析(VLM)产出的原文与球队看板结构化结果。未识别值为 null，未发生事件为空数组。 */
  text_result?: VlmTextResult;
  eta_seconds?: number | null;
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

export interface VlmTextResult {
  content: string;
  raw_content?: string;
  model?: string;
  generated_at?: string;
  parse_status?: "parsed" | "invalid" | "empty";
  parse_error?: string | null;
  structured?: VlmDashboard | null;
}

export interface VlmDashboard {
  schema_version: string;
  source: "qwen-vlm" | string;
  data_status: "model_estimate" | string;
  notes: string[];
  match: { name: string | null; duration_seconds: number | null; score: { home: number | null; away: number | null } };
  teams: { home: VlmTeam; away: VlmTeam; [key: string]: unknown };
  summary: { headline: string | null; highlight: string | null; weakness: string | null; next_focus: string | null; [key: string]: unknown };
  players: VlmPlayer[];
  events: VlmEvent[];
  source_frames: unknown[];
  [key: string]: unknown;
}

export interface VlmTeam {
  id: string | null; name: string | null; score: number | null; possession_pct: number | null;
  shots: number | null; shots_on_target: number | null; average_score: number | null;
  stats: Record<string, number | null>; highlights: unknown[]; weaknesses: unknown[]; next_focus: unknown[];
  [key: string]: unknown;
}

export interface VlmPlayer {
  id: string | null; number: string | null; name: string | null; position: string | null; score: number | null;
  stats: Record<string, number | null>; insights: unknown[]; events: unknown[]; title: string | null;
  highlight: Record<string, unknown> | null; source: string;
  [key: string]: unknown;
}

export interface VlmEvent {
  time_seconds: number | null; type: string | null; team: string | null; player_id: string | null;
  player_number: string | null; outcome: string | null; note: string | null; source: string;
  [key: string]: unknown;
}

export interface ClaimRequest { worker_id: string; lease_seconds: number }
export interface LeaseRequest { task_id: string; lease_token: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
