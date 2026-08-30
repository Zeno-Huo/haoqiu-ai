// 全面转向 VLM 后不再有 worker 租约中间态：排队 -> 成功 / 失败。
export type DetectionJobStatus = 'queued' | 'succeeded' | 'failed'
export type DetectionJobStage = string

export interface CloudUploadTicketRequest {
  client_match_id: string
  filename: string
  content_type: string
  size_bytes: number
  duration_seconds: number
}

export interface CloudUploadTicket {
  upload_id: string
  method: 'PUT'
  upload_url: string
  headers: Record<string, string>
  expires_at: string
  max_size_bytes: number
}

/** instant = 团队比赛；single = 个人比赛。两者都由 VLM（视觉大模型）产出文字复盘。 */
export type CloudAnalysisMode = 'instant' | 'single'

export interface CloudTextResult {
  content: string
  raw_content?: string
  model?: string
  generated_at?: string
  parse_status?: 'parsed' | 'invalid' | 'empty'
  parse_error?: string | null
  /** VLM 结构化看板；旧服务仍可能只返回 content。 */
  analysis?: unknown
  dashboard?: unknown
  structured?: unknown
}

export interface CloudDetectionJob {
  job_id: string
  client_match_id?: string
  status: DetectionJobStatus
  progress: number
  stage?: DetectionJobStage
  mode?: CloudAnalysisMode
  created_at?: string
  started_at?: string
  completed_at?: string
  input?: { filename: string; content_type: string; size_bytes: number; duration_seconds: number }
  text_result?: CloudTextResult
  /** 兼容不同版本后端把结构化结果放在任务顶层。 */
  analysis?: unknown
  dashboard?: unknown
  structured?: unknown
  error?: { code: string; message: string }
}
