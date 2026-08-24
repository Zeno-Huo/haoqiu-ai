import type { CloudDetectionJob, CloudUploadTicket, CloudUploadTicketRequest, SignedDetectionVideo } from '../cloudDetectionTypes'
import { getCloudBaseAccessToken } from './cloudBaseAuth'

const cloudBase = (import.meta.env.VITE_CLOUDBASE_API_BASE as string | undefined)?.trim().replace(/\/+$/, '') ?? ''

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
  return Boolean(cloudBase)
}

function endpoint(path: string): string {
  if (!cloudBase) throw new CloudDetectionApiError('未配置 CloudBase API 地址')
  return `${cloudBase}${path}`
}

async function parseError(response: Response): Promise<CloudDetectionApiError> {
  try {
    const body = await response.json() as { detail?: string; error?: { code?: string; message?: string } }
    return new CloudDetectionApiError(body.error?.message || body.detail || `请求失败（${response.status}）`, {
      status: response.status,
      code: body.error?.code,
    })
  } catch {
    return new CloudDetectionApiError(`请求失败（${response.status}）`, { status: response.status })
  }
}

async function cloudRequest<T>(path: string, init?: RequestInit, expectedStatus?: number): Promise<T> {
  let response: Response
  try {
    const accessToken = await getCloudBaseAccessToken()
    response = await fetch(endpoint(path), {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers, Authorization: `Bearer ${accessToken}` },
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : ''
    throw new CloudDetectionApiError(detail || '无法连接 CloudBase 服务，请检查网络后重试')
  }
  if (!response.ok) throw await parseError(response)
  if (expectedStatus && response.status !== expectedStatus) {
    throw new CloudDetectionApiError(`服务返回了非预期状态（${response.status}）`, { status: response.status })
  }
  return response.json() as Promise<T>
}

export function requestCloudUploadTicket(request: CloudUploadTicketRequest): Promise<CloudUploadTicket> {
  return cloudRequest('/api/v1/cos-upload-tickets', { method: 'POST', body: JSON.stringify(request) }, 201)
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

export function createCloudDetectionJob(uploadId: string, clientMatchId: string): Promise<CloudDetectionJob> {
  return cloudRequest('/api/v1/cloud-detection-jobs', {
    method: 'POST',
    body: JSON.stringify({ upload_id: uploadId, client_match_id: clientMatchId }),
  }, 202)
}

export function getCloudDetectionJob(jobId: string): Promise<CloudDetectionJob> {
  return cloudRequest(`/api/v1/cloud-detection-jobs/${encodeURIComponent(jobId)}`)
}

export function getSignedDetectionVideo(jobId: string): Promise<SignedDetectionVideo> {
  return cloudRequest(`/api/v1/cloud-detection-jobs/${encodeURIComponent(jobId)}/artifacts/annotated-video-url`, { method: 'POST' })
}
