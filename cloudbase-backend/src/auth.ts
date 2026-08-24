import crypto from "node:crypto";
import { ApiError } from "./types";

const first = (value: unknown): string | undefined => Array.isArray(value) ? String(value[0]) : typeof value === "string" ? value : undefined;

export const normalizeHeaders = (headers: Record<string, unknown> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), first(value) || ""]));

export const requireUser = (event: any, context: any, allowTestIdentity: boolean): string => {
  // HTTP access service places its gateway-verified identity here. Older CloudBase
  // triggers use context.auth/event.userInfo; request headers are never identity sources.
  const verified = context?.extendedContext?.userId || context?.auth?.uid || context?.auth?.openId || event?.userInfo?.uid || event?.userInfo?.openId;
  if (verified) return String(verified);
  const testUser = normalizeHeaders(event?.headers)["x-test-user-id"];
  if (allowTestIdentity && testUser && /^[a-zA-Z0-9:_-]{1,128}$/.test(testUser)) return testUser;
  throw new ApiError(401, "AUTH_REQUIRED", "需要登录后操作");
};

export const requireWorker = (event: any, configuredToken?: string, expectedEnv?: string): void => {
  if (!configuredToken) throw new ApiError(503, "WORKER_AUTH_NOT_CONFIGURED", "worker identity is not configured");
  const headers = normalizeHeaders(event?.headers);
  const authorization = headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(configuredToken);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new ApiError(401, "WORKER_AUTH_INVALID", "invalid worker identity");
  }
  if (expectedEnv && headers["x-cloudbase-env"] !== expectedEnv) {
    throw new ApiError(403, "WORKER_ENV_INVALID", "worker CloudBase environment is invalid");
  }
};
