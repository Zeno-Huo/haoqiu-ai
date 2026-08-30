import { ApiError } from "./types";

export const DEFAULT_WEB_ORIGIN = "https://haoqiu-ai-prod-d3g2cm2xn3255c273-1352817304.tcloudbaseapp.com";

export const parseAllowedWebOrigins = (raw?: string): string[] => {
  const values = (raw?.trim() ? raw : DEFAULT_WEB_ORIGIN).split(/[,;]/).map((value) => value.trim()).filter(Boolean);
  const unique = new Set<string>();
  for (const value of values) {
    if (value === "*") throw new Error("ALLOWED_WEB_ORIGINS must not contain a wildcard");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`Invalid web origin: ${value}`); }
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== value || url.username || url.password) {
      throw new Error(`ALLOWED_WEB_ORIGINS entries must be exact HTTP(S) origins: ${value}`);
    }
    unique.add(value);
  }
  return [...unique];
};

export const requireAllowedOrigin = (origin: string | undefined, allowed: readonly string[]): void => {
  if (origin && !allowed.includes(origin)) throw new ApiError(403, "CORS_ORIGIN_DENIED", "请求来源不允许");
};

export const requireAllowedPreflight = (requestedMethod?: string, requestedHeaders?: string): void => {
  // DELETE 用于网页端删除云端任务及其视频：此前 History 只删 localStorage，云端文件永不释放。
  if (requestedMethod && !["GET", "POST", "DELETE", "OPTIONS"].includes(requestedMethod.toUpperCase())) {
    throw new ApiError(403, "CORS_METHOD_DENIED", "跨域请求方法不允许");
  }
  const allowedHeaders = new Set(["authorization", "content-type"]);
  const headers = (requestedHeaders || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (headers.some((header) => !allowedHeaders.has(header))) {
    throw new ApiError(403, "CORS_HEADERS_DENIED", "跨域请求头不允许");
  }
};

export const corsHeaders = (origin: string | undefined, allowed: readonly string[]): Record<string, string> => {
  const headers: Record<string, string> = { vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-methods"] = "GET,POST,DELETE,OPTIONS";
    headers["access-control-allow-headers"] = "Authorization,Content-Type";
    headers["access-control-max-age"] = "600";
  }
  return headers;
};
