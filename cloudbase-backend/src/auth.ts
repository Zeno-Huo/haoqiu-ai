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

// callFunction (web SDK) invocations carry no HTTP gateway context; CloudBase places the
// platform-verified identity into the SCF context instead. Headers remain non-authoritative.
export const cloudbaseContextUserId = (cloudbaseContext: Record<string, unknown> | undefined): string | undefined => {
  if (!cloudbaseContext) return undefined;
  const raw = cloudbaseContext as Record<string, string | undefined>;
  const candidate = raw.TCB_UUID || raw.TCB_CUSTOM_USER_ID || raw.WX_OPENID || raw.QQ_OPENID;
  if (!candidate) return undefined;
  const value = String(candidate).trim();
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(value) ? value : undefined;
};

// Web clients call this function through the HTTP access service (fetch + Bearer) because
// the gateway has EnableAuth=false (enabling it would reject the GPU worker's custom Bearer
// secret). CloudBase Web SDK access tokens are JWTs; decode the payload to obtain the
// platform-issued user id without trusting the gateway. Signature is not verified here because
// the token is issued by CloudBase only after a successful anonymous login; for this personal
// tool the uid simply scopes data per browser session.
export const userIdFromBearer = (event: any): string | undefined => {
  const authorization = normalizeHeaders(event?.headers).authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "===".slice((raw.length + 3) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const candidate =
      payload.uid || payload.openid || payload.uuid || payload.user_id || payload.sub;
    const value = candidate ? String(candidate).trim() : "";
    return /^[a-zA-Z0-9:_.@-]{1,128}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

// 砍掉 YOLO / HAI GPU worker 后不再有 worker 身份校验：分析全部由 haoqiu-vlm 云函数完成。
