import type { DetectionDiagnostics, DetectionErrorInfo, DetectionInputInfo, DetectionJobStage, DetectionJobStatus, DetectionModelInfo } from './detectionTypes'

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

/** instant = 视觉大模型文字复盘；deep = GPU 逐帧检测并生成标注视频。 */
export type CloudAnalysisMode = 'instant' | 'deep'

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
  model?: DetectionModelInfo
  input?: DetectionInputInfo
  diagnostics?: DetectionDiagnostics
  warnings?: string[]
  artifacts?: {
    annotated_video_ready: boolean
  }
  text_result?: CloudTextResult
  /** 兼容不同版本后端把结构化结果放在任务顶层。 */
  analysis?: unknown
  dashboard?: unknown
  error?: DetectionErrorInfo
}

export interface SignedDetectionVideo {
  url: string
  expires_at: string
  content_type: 'video/mp4'
}
