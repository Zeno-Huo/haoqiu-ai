const CLOUDBASE_ENV_ID = 'haoqiu-ai-prod-d3g2cm2xn3255c273'

const authPromise = Promise.all([
  import('@cloudbase/js-sdk/app'),
  import('@cloudbase/js-sdk/auth'),
]).then(([appModule, authModule]) => {
  const cloudbase = appModule.default
  authModule.registerAuth(cloudbase)
  return cloudbase.init({
    env: CLOUDBASE_ENV_ID,
    region: 'ap-shanghai',
  }).auth({ persistence: 'local' })
})

let sessionPromise: Promise<void> | undefined

async function ensureAnonymousSession(): Promise<void> {
  const auth = await authPromise
  const current = await auth.getLoginState()
  if (current) return

  const result = await auth.signInAnonymously()
  if (result.error) throw new Error(result.error.message || '匿名登录失败')
}

export async function getCloudBaseAccessToken(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = ensureAnonymousSession().finally(() => {
      sessionPromise = undefined
    })
  }
  await sessionPromise

  const auth = await authPromise
  const { accessToken } = await auth.getAccessToken()
  if (!accessToken) throw new Error('未取得 CloudBase 访问凭证')
  return accessToken
}
