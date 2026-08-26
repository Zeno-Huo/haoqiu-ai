import type { DetectionHealth, DetectionJob } from '../detectionTypes'

const configuredBase = (import.meta.env.VITE_DETECTION_API_BASE as string | undefined)?.trim().replace(/\/$/, '') ?? ''

export class DetectionApiError extends Error {
  status?: number
  code?: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)
    this.name = 'DetectionApiError'
    this.status = options?.status
    this.code = options?.code
  }
}

export function isDetectionServiceConfigured(): boolean {
  return Boolean(configuredBase)
}

function endpoint(path: string): string {
  if (!configuredBase) throw new DetectionApiError('未配置真实检测服务地址')
  return `${configuredBase}${path}`
}

async function readError(response: Response): Promise<DetectionApiError> {
  try {
    const body = await response.json() as { detail?: string; error?: { code?: string; message?: string } }
    return new DetectionApiError(body.error?.message || body.detail || `请求失败（${response.status}）`, {
      status: response.status,
      code: body.error?.code,
    })
  } catch {
    return new DetectionApiError(`请求失败（${response.status}）`, { status: response.status })
  }
}

export async function createDetectionJob(video: File, clientMatchId?: string): Promise<DetectionJob> {
  const form = new FormData()
  form.append('video', video)
  if (clientMatchId) form.append('client_match_id', clientMatchId)
  let response: Response
  try {
    response = await fetch(endpoint('/api/v1/detection-jobs'), { method: 'POST', body: form })
  } catch {
    throw new DetectionApiError('无法连接真实检测服务，请检查服务地址与网络')
  }
  if (!response.ok) throw await readError(response)
  if (response.status !== 202) throw new DetectionApiError(`创建任务返回了非预期状态（${response.status}）`, { status: response.status })
  return response.json() as Promise<DetectionJob>
}

export async function getDetectionJob(jobId: string): Promise<DetectionJob> {
  let response: Response
  try {
    response = await fetch(endpoint(`/api/v1/detection-jobs/${encodeURIComponent(jobId)}`))
  } catch {
    throw new DetectionApiError('暂时无法获取检测进度，可以稍后重试')
  }
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<DetectionJob>
}

export async function getDetectionHealth(): Promise<DetectionHealth> {
  let response: Response
  try {
    response = await fetch(endpoint('/health'))
  } catch {
    throw new DetectionApiError('无法连接真实检测服务')
  }
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<DetectionHealth>
}

export function resolveDetectionArtifactUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return endpoint(path.startsWith('/') ? path : `/${path}`)
}
