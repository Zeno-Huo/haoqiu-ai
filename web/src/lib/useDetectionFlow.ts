import { useEffect, useState } from 'react'
import type { CloudDetectionJob, SignedDetectionVideo } from '../cloudDetectionTypes'
import { createCloudDetectionJob, getCloudDetectionJob, getSignedDetectionVideo, isCloudDetectionConfigured } from './cloudDetectionApi'
import { ensureUploadedVideo, UPLOAD_PHASE_LABELS, type UploadPhase } from './cloudUploadWorkflow'
import { getCachedVideoFile } from './videoFileCache'
import { getMatch, saveMatch } from './storage'

/**
 * 个人比赛 / 个人训练共用的 YOLO 检测分析流程：
 * 上传视频 → 创建检测任务 → 轮询进度 → 取带框视频。
 * 复用同一套 trackingJobId / trackingDetectionJob 字段。
 */
export function useDetectionFlow(matchId: string | undefined, options: { focusHint?: string; trainingItem?: string } = {}) {
  const initialMatch = typeof matchId === 'string' ? getMatch(matchId) : undefined
  const [job, setJob] = useState<CloudDetectionJob | undefined>(initialMatch?.trackingDetectionJob)
  const [phase, setPhase] = useState<UploadPhase>('ticket')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [resultVideo, setResultVideo] = useState<SignedDetectionVideo>()
  const configured = isCloudDetectionConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    let cancelled = false
    let timer: number | undefined
    const match = initialMatch

    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.trackingJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) throw new Error('本地视频文件已在刷新后丢失，请重新选择视频。')
          const uploadId = await ensureUploadedVideo(match.id, file, (next, progress) => {
            if (!cancelled) { setPhase(next); setUploadProgress(progress) }
          })
          const created = await createCloudDetectionJob(uploadId, match.id, 'single', options.focusHint, options.trainingItem)
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
          saveMatch({ ...latest, cloudUploadId: uploadId, trackingJobId: jobId, trackingDetectionJob: created })
        }
        async function poll() {
          if (!jobId || cancelled) return
          const current = await getCloudDetectionJob(jobId)
          if (cancelled) return
          setJob(current)
          const currentMatch = getMatch(match.id) ?? match
          saveMatch({ ...currentMatch, trackingJobId: current.job_id, trackingDetectionJob: current })
          if (current.status === 'succeeded') {
            if (current.artifacts?.annotated_video_ready) {
              const signed = await getSignedDetectionVideo(current.job_id)
              if (!cancelled) setResultVideo(signed)
            }
            return
          }
          if (current.status !== 'failed') timer = window.setTimeout(poll, 2000)
        }
        await poll()
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '分析任务创建失败，请重新选择视频。')
      }
    }
    void run()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [configured, initialMatch, options.focusHint, options.trainingItem])

  const hasUploadId = !!initialMatch?.cloudUploadId || !!job
  const isUploading = !hasUploadId
  const gpuSuccess = job?.status === 'succeeded'
  const gpuFailed = job?.status === 'failed'
  const isAnalyzing = hasUploadId && !gpuSuccess && !gpuFailed
  const isReportReady = gpuSuccess
  const unifiedProgress = isUploading ? uploadProgress : (job?.progress ?? 0)

  let stageLabel: string
  if (isUploading) stageLabel = UPLOAD_PHASE_LABELS[phase]
  else if (isAnalyzing) {
    if (!job) stageLabel = '正在准备分析任务'
    else if (job.status === 'queued') stageLabel = '正在排队等待分析'
    else stageLabel = 'AI 正在逐帧分析你的训练画面'
  } else stageLabel = '分析完成'

  return {
    job, phase, uploadProgress, message, resultVideo, configured,
    isUploading, isAnalyzing, isReportReady, gpuFailed,
    unifiedProgress, stageLabel,
  }
}
