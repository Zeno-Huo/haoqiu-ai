export interface Config {
  envId: string;
  bucket: string;
  region: string;
  uploadUrlSeconds: number;
  pendingUploadSeconds: number;
  resultUrlSeconds: number;
  rawRetentionDays: number;
  resultRetentionDays: number;
  maxUploadBytes: number;
  maxDurationSeconds: number;
  maxLeaseSeconds: number;
  workerToken?: string;
  allowTestIdentity: boolean;
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
  resultUrlSeconds: Math.min(integer("RESULT_URL_SECONDS", 600), 900),
  rawRetentionDays: integer("RAW_RETENTION_DAYS", 7),
  resultRetentionDays: integer("RESULT_RETENTION_DAYS", 30),
  maxUploadBytes: 300 * 1024 * 1024,
  maxDurationSeconds: 15 * 60,
  maxLeaseSeconds: Math.min(integer("MAX_LEASE_SECONDS", 120), 300),
  workerToken: process.env.WORKER_API_TOKEN,
  allowTestIdentity: process.env.ALLOW_TEST_IDENTITY === "true" && process.env.NODE_ENV !== "production"
});
