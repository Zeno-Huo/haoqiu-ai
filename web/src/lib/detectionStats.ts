// 由深度复盘任务结果（GPU 逐帧目标检测）派生真实检测概览。
// 数据来源：job.diagnostics（已在后端 publicTask 中返回），不依赖任何演示数据。
import type { CloudDetectionJob } from '../cloudDetectionTypes'
import type { DetectionStats } from '../types'

export function buildDetectionStats(job: CloudDetectionJob): DetectionStats | undefined {
  const d = job.diagnostics
  if (!d) return undefined
  const byClass = d.frame_detections_by_class || {}
  const playerFrames = byClass['player'] ?? 0
  const ballFrames = byClass['ball'] ?? 0
  const refereeFrames = byClass['referee'] ?? 0
  const processed = Math.max(1, d.processed_frames)
  return {
    modelName: job.model?.name,
    modelVersion: job.model?.version,
    filename: job.input?.filename,
    durationSeconds: job.input?.duration_seconds,
    resolution: job.input ? `${job.input.width}×${job.input.height}` : undefined,
    fps: job.input?.fps,
    processedFrames: d.processed_frames,
    sourceFrames: d.source_frames,
    fullVideoProcessed: d.full_video_processed,
    classesSeen: d.classes_seen,
    frameDetectionsByClass: byClass,
    playerFrames,
    ballFrames,
    refereeFrames,
    playerPresenceRate: Math.round((playerFrames / processed) * 100),
    ballPresenceRate: Math.round((ballFrames / processed) * 100),
    generatedAt: new Date().toISOString(),
  }
}

/** 检测类别中文标签；未命中时使用原类别名。 */
export function classLabel(cls: string): string {
  const map: Record<string, string> = {
    player: '球员',
    ball: '球',
    referee: '裁判',
    goalkeeper: '门将',
  }
  return map[cls] ?? cls
}
