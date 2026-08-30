import { parseAllowedWebOrigins } from "./http-cors";

export interface Config {
  envId: string;
  bucket: string;
  region: string;
  uploadUrlSeconds: number;
  pendingUploadSeconds: number;
  rawRetentionDays: number;
  maxUploadBytes: number;
  maxDurationSeconds: number;
  allowTestIdentity: boolean;
  allowedWebOrigins: string[];
  vlmProvider: string;
  vlmApiKey?: string;
  vlmModel: string;
  cdnBase?: string;
  queuedTtlSeconds: number;
}

export const loadTencentCredentials = (env: NodeJS.ProcessEnv = process.env) => ({
  SecretId: env.TENCENTCLOUD_SECRETID || env.TENCENT_SECRET_ID,
  SecretKey: env.TENCENTCLOUD_SECRETKEY || env.TENCENT_SECRET_KEY,
  SecurityToken: env.TENCENTCLOUD_SESSIONTOKEN || env.TENCENT_SESSION_TOKEN
});

const integer = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
};

export const loadConfig = (): Config => ({
  envId: process.env.CLOUDBASE_ENV_ID || "haoqiu-ai-prod-d3g2cm2xn3255c273",
  bucket: process.env.COS_BUCKET || "haoqiu-ai-media-1352817304",
  region: process.env.COS_REGION || "ap-shanghai",
  uploadUrlSeconds: Math.min(integer("UPLOAD_URL_SECONDS", 600), 900),
  pendingUploadSeconds: integer("PENDING_UPLOAD_SECONDS", 86400),
  rawRetentionDays: integer("RAW_RETENTION_DAYS", 7),
  // 硬限制放宽：超过 150MB / 5 分钟的视频由 haoqiu-vlm 自动压缩，不再直接拒绝用户
  maxUploadBytes: 1024 * 1024 * 1024,
  maxDurationSeconds: 20 * 60,
  allowTestIdentity: process.env.ALLOW_TEST_IDENTITY === "true" && process.env.NODE_ENV !== "production",
  allowedWebOrigins: parseAllowedWebOrigins(process.env.ALLOWED_WEB_ORIGINS),
  vlmProvider: process.env.VLM_PROVIDER || "qwen",
  vlmApiKey: process.env.VLM_API_KEY || process.env.DASHSCOPE_API_KEY,
  vlmModel: process.env.VLM_MODEL || "qwen-vl-plus",
  // COS 外网下行流量是本项目主要云成本：VLM 每轮分析、前端回放都从源站拖整段视频。
  // 给媒体桶挂上 CDN 加速域名后填到这里（如 https://media.example.com）：
  // 签名 URL 只替换域名、签名参数原样保留，CDN 回源仍以源站 Host 校验，鉴权可正常通过。
  cdnBase: (process.env.COS_CDN_BASE || process.env.CDN_BASE || "").trim().replace(/\/$/, "") || undefined,
  // 排队任务超时：VLM 云函数若迟迟没处理完、或异常退出没回写结果，任务会永远停在 queued，
  // 前端会一直轮询它们。超过这个时长就判为失败，终止无效轮询与随之而来的 COS 请求费。
  queuedTtlSeconds: integer("QUEUED_TTL_SECONDS", 1800)
});
