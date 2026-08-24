export type DetectionJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type DetectionJobStage = 'queued' | 'probing' | 'detecting' | 'rendering' | 'completed' | 'failed'

export interface DetectionModelInfo {
  name: string
  version: string
}

export interface DetectionInputInfo {
  filename: string
  duration_seconds: number
  width: number
  height: number
  fps: number
}

export interface DetectionDiagnostics {
  processed_frames: number
  classes_seen: string[]
  frame_detections_by_class: Record<string, number>
}

export interface DetectionErrorInfo {
  code: string
  message: string
}

export interface DetectionArtifacts {
  annotated_video_url: string
}

/** POST/GET 均使用的任务快照；字段随任务阶段逐步补齐。 */
export interface DetectionJob {
  job_id: string
  client_match_id?: string
  status: DetectionJobStatus
  progress: number
  stage?: DetectionJobStage
  created_at?: string
  started_at?: string
  completed_at?: string
  model?: DetectionModelInfo
  input?: DetectionInputInfo
  diagnostics?: DetectionDiagnostics
  warnings?: string[]
  artifacts?: DetectionArtifacts
  error?: DetectionErrorInfo
}

export interface DetectionHealth {
  status: 'ok'
  gpu_available: boolean
  model_loaded: boolean
  active_jobs: number
  queued_jobs: number
}
