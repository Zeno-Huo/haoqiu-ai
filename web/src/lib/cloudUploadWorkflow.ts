import { putWholeVideoToCos, requestCloudUploadTicket } from './cloudDetectionApi'
import { getMatch, saveMatch } from './storage'
import { clearCachedVideoFile } from './videoFileCache'

export type UploadPhase = 'ticket' | 'uploading' | 'creating'
export type UploadListener = (phase: UploadPhase, progress: number) => void

interface InflightUpload {
  promise: Promise<string>
  listeners: Set<UploadListener>
  phase: UploadPhase
  progress: number
}

// 同一场比赛只上传一次；即时分析与深度复盘共用这份 upload_id。
const uploadsByMatch = new Map<string, InflightUpload>()

export const UPLOAD_PHASE_LABELS: Record<UploadPhase, string> = {
  ticket: '正在取得安全上传信息',
  uploading: '正在上传完整视频',
  creating: '正在创建云端分析任务',
}

/** 确保这场比赛的整段视频已直传 COS，返回可复用的 upload_id。 */
export function ensureUploadedVideo(matchId: string, file: File | undefined, listener: UploadListener): Promise<string> {
  const existing = uploadsByMatch.get(matchId)
  if (existing) {
    existing.listeners.add(listener)
    listener(existing.phase, existing.progress)
    return existing.promise
  }

  const state: InflightUpload = {
    promise: Promise.resolve(''),
    listeners: new Set([listener]),
    phase: 'ticket',
    progress: 0,
  }
  const report = (phase: UploadPhase, progress: number) => {
    state.phase = phase
    state.progress = progress
    for (const notify of state.listeners) notify(phase, progress)
  }

  state.promise = (async () => {
    const latest = getMatch(matchId)
    if (!latest) throw new Error('找不到这段视频记录')
    if (latest.cloudUploadId) {
      report('creating', 100)
      return latest.cloudUploadId
    }

    if (!file) throw new Error('本地视频文件已在刷新后丢失。云端上传尚未完成，请重新选择视频。')
    const durationSeconds = latest.videoMeta?.durationSeconds
    if (!durationSeconds || !Number.isFinite(durationSeconds)) throw new Error('未读取到视频时长，请重新选择视频。')

    report('ticket', 0)
    const ticket = await requestCloudUploadTicket({
      client_match_id: matchId,
      filename: file.name,
      content_type: file.type || (file.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
      size_bytes: file.size,
      duration_seconds: durationSeconds,
    })
    report('uploading', 0)
    await putWholeVideoToCos(file, ticket, (progress) => report('uploading', progress))

    const afterUpload = getMatch(matchId) ?? latest
    saveMatch({ ...afterUpload, cloudUploadId: ticket.upload_id })
    clearCachedVideoFile(matchId)
    report('creating', 100)
    return ticket.upload_id
  })().finally(() => uploadsByMatch.delete(matchId))

  uploadsByMatch.set(matchId, state)
  return state.promise
}
