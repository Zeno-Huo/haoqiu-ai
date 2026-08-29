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

/** YOLO 逐帧识别出的主角（HAI 真实检测，非用户输入）。 */
export interface DetectionFocalPlayer {
  number?: string | null
  color?: string | null
}

/** YOLO 事件规则引擎产出的客观数据；HAI 未返回时前端不展示。 */
export interface DetectionEvents {
  touches?: number | null
  passes?: number | null
  pass_success?: number | null
  shots?: number | null
  steals?: number | null
  possession_rate?: number | null // 0~1
  focal_player?: DetectionFocalPlayer | null
}

/** 个人训练：HAI 按 training_item 返回的训练指标 + 一句话练习建议；未升级时缺省。 */
export interface DetectionTrainingMetrics {
  item?: string | null
  reps?: number | null // 完成组数 / 连续次数（如颠球）
  success?: number | null // 成功次数
  success_rate?: number | null // 0~1
  best_streak?: number | null // 最长连续（颠球）
  avg_power?: number | null // 平均力量（射门）
  on_target?: number | null // 射正次数
  turns?: number | null // 变向次数（带球）
  advice?: string | null // HAI 基于指标生成的一句话练习建议（真实不编）
}

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
  /** YOLO 事件统计（触球/传球/射门/抢断/控球率 + 真实主角）；HAI 未升级时缺省。 */
  events?: DetectionEvents
  /** 个人训练指标（按 training_item 差异化）+ 练习建议；HAI 未升级时缺省。 */
  training?: DetectionTrainingMetrics | null
  error?: DetectionErrorInfo
}

export interface SignedDetectionVideo {
  url: string
  expires_at: string
  content_type: 'video/mp4'
}
