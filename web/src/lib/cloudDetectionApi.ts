import type { CloudDetectionJob, CloudUploadTicket, CloudUploadTicketRequest } from '../cloudDetectionTypes'
import { getCloudBaseAccessToken } from './cloudBaseAuth'

export class CloudDetectionApiError extends Error {
  status?: number
  code?: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)
    this.name = 'CloudDetectionApiError'
    this.status = options?.status
    this.code = options?.code
  }
}

export function isCloudDetectionConfigured(): boolean {
  return Boolean(API_BASE)
}

function parsePayload(body: unknown): any {
  if (body === undefined || body === null || body === '') return undefined
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

// HTTP 访问服务基地址；仓库无 .env 时回落到线上网关，仍可经 VITE_DETECTION_API_BASE 覆盖。
const API_BASE =
  (import.meta.env.VITE_DETECTION_API_BASE as string | undefined)?.trim().replace(/\/$/, '') ||
  'https://haoqiu-ai-prod-d3g2cm2xn3255c273.service.tcloudbase.com/haoqiu-api'

/** 通过 HTTP 访问服务直调后端；前端附带 CloudBase 匿名登录的访问令牌，后端从中解析用户身份。 */
async function invoke<T>(method: 'GET' | 'POST' | 'DELETE', path: string, payload?: Record<string, unknown>, expectedStatus?: number): Promise<T> {
  const accessToken = await getCloudBaseAccessToken()
  const url = `${API_BASE}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
    })
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : JSON.stringify(error)
    throw new CloudDetectionApiError(`无法连接 CloudBase 服务 [${detail}]`)
  }

  const text = await response.text()
  const data = parsePayload(text)

  if (!response.ok) {
    const error = data as { error?: { code?: string; message?: string }; detail?: string } | undefined
    throw new CloudDetectionApiError(error?.error?.message || error?.detail || `请求失败（${response.status}）`, {
      status: response.status,
      code: error?.error?.code,
    })
  }
  if (expectedStatus && response.status !== expectedStatus) {
    throw new CloudDetectionApiError(`服务返回了非预期状态（${response.status}）`, { status: response.status })
  }
  return data as T
}

export function requestCloudUploadTicket(request: CloudUploadTicketRequest): Promise<CloudUploadTicket> {
  return invoke('POST', '/api/v1/cos-upload-tickets', request as unknown as Record<string, unknown>, 201)
}

export function putWholeVideoToCos(
  file: File,
  ticket: CloudUploadTicket,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(ticket.method, ticket.upload_url)
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)))
    }
    xhr.onerror = () => reject(new CloudDetectionApiError('COS 视频上传失败，请检查网络后重试'))
    xhr.onabort = () => reject(new CloudDetectionApiError('COS 视频上传已取消'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
      } else {
        reject(new CloudDetectionApiError(`COS 视频上传失败（${xhr.status}）`, { status: xhr.status }))
      }
    }
    xhr.send(file)
  })
}

/** 即时分析 / 个人比赛 / 个人训练：复用同一段已上传视频，交给视觉大模型出文字复盘。 */
export interface InstantTeamContext {
  team_name?: string
  jersey_hint?: string
  training_item?: string
  opening_frame_point?: { x: number; y: number }
}

export function createInstantAnalysisJob(uploadId: string, clientMatchId: string, teamContext?: InstantTeamContext): Promise<CloudDetectionJob> {
  return invoke('POST', '/api/v1/instant-analysis', { upload_id: uploadId, client_match_id: clientMatchId, analysis_context: teamContext }, 202)
}

export function getInstantAnalysisJob(jobId: string): Promise<CloudDetectionJob> {
  return invoke('GET', `/api/v1/instant-analysis/${encodeURIComponent(jobId)}`)
}

export interface DeleteDetectionJobResult {
  task_id: string
  deleted_objects: string[]
  kept_objects: string[]
}

/** 删除云端任务并释放它占用的 COS 视频存储。
 *  此前网页端"删除"只清 localStorage，云端任务 JSON 与视频永不释放，测试视频因此一直堆积。 */
export function deleteCloudDetectionJob(jobId: string): Promise<DeleteDetectionJobResult> {
  return invoke('DELETE', `/api/v1/cloud-detection-jobs/${encodeURIComponent(jobId)}`)
}

export function deleteInstantAnalysisJob(jobId: string): Promise<DeleteDetectionJobResult> {
  return invoke('DELETE', `/api/v1/instant-analysis/${encodeURIComponent(jobId)}`)
}
