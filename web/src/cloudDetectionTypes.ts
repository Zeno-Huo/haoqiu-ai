import type { DetectionErrorInfo, DetectionInputInfo, DetectionJobStage, DetectionJobStatus, DetectionModelInfo } from './detectionTypes'

export interface CloudUploadTicketRequest {
  client_match_id: string
  filename: string
  content_type: string
  size_bytes: number
}

export interface CloudUploadTicket {
  upload_id: string
  method: 'PUT'
  upload_url: string
  headers: Record<string, string>
  expires_at: string
  max_size_bytes: number
}

export interface CloudDetectionJob {
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
  warnings?: string[]
  artifacts?: {
    annotated_video_ready: boolean
  }
  error?: DetectionErrorInfo
}

export interface SignedDetectionVideo {
  url: string
  expires_at: string
  content_type: 'video/mp4'
}
