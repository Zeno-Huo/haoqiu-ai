const CLOUDBASE_ENV_ID = 'haoqiu-ai-prod-d3g2cm2xn3255c273'
const CLOUDBASE_REGION = 'ap-shanghai'

type CloudBaseApp = {
  auth: (options?: { persistence: 'local' | 'session' | 'none' }) => any
  callFunction?: (options: { name: string; data?: Record<string, unknown> }) => Promise<{ result: any }>
}

const appPromise = Promise.all([
  import('@cloudbase/js-sdk/app'),
  import('@cloudbase/js-sdk/auth'),
  import('@cloudbase/js-sdk/functions'),
]).then(([appModule, authModule, functionsModule]) => {
  const cloudbase = appModule.default
  authModule.registerAuth(cloudbase)
  functionsModule.registerFunctions(cloudbase)
  const app = cloudbase.init({ env: CLOUDBASE_ENV_ID, region: CLOUDBASE_REGION }) as unknown as CloudBaseApp
  return { app, auth: app.auth({ persistence: 'local' }) }
})

let sessionPromise: Promise<void> | undefined

async function signIn(): Promise<void> {
  const { auth } = await appPromise
  const current = await auth.getLoginState()
  if (current) return

  const result = await auth.signInAnonymously()
  if (result?.error) throw new Error(`匿名登录失败：${result.error.message || 'unknown'}`)
  console.error('[cloudbase] signInAnonymously result=', JSON.stringify(result))

  // 匿名登录返回后再确认一次登录态，避免后续调用抢跑到凭证写入之前。
  const confirmed = await auth.getLoginState()
  if (!confirmed) throw new Error('登录状态未生效，请刷新页面后重试')
}

/** 保证当前浏览器已有可用的 CloudBase 登录态（匿名即可）；并发调用共享同一次登录。 */
export async function ensureCloudBaseSession(): Promise<void> {
  if (!sessionPromise) {
    sessionPromise = signIn().finally(() => {
      sessionPromise = undefined
    })
  }
  await sessionPromise
}

/** 取得已登录的 CloudBase 应用实例；云函数调用由 SDK 自动附带身份，无需前端拼 Bearer。 */
export async function getCloudBaseApp(): Promise<CloudBaseApp> {
  await ensureCloudBaseSession()
  const { app } = await appPromise
  return app
}

export async function getCloudBaseAccessToken(): Promise<string> {
  await ensureCloudBaseSession()
  const { auth } = await appPromise
  const { accessToken } = await auth.getAccessToken()
  if (!accessToken) throw new Error('未取得 CloudBase 访问凭证')
  return accessToken
}
