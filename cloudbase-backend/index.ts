import cloudbase from "@cloudbase/node-sdk";
import { cloudbaseContextUserId, normalizeHeaders, requireUser, userIdFromBearer } from "./src/auth";
import { loadConfig, loadTencentCredentials } from "./src/config";
import { TencentCosStore } from "./src/cos";
import { CosRepository } from "./src/cos-repository";
import { TaskService } from "./src/service";
import { ApiError } from "./src/types";
import type { TaskRecord } from "./src/types";
import { publicTask } from "./src/http-contract";
import { corsHeaders, requireAllowedOrigin, requireAllowedPreflight } from "./src/http-cors";

// 吞掉未处理的 Promise rejection，避免云函数进程崩溃（历史遗留：旧 SDK 的 createCollection
// 逃逸拒绝问题；现在已不再依赖 createCollection，此处仅作兜底）。
let lastUnhandled: string | undefined;
process.on("unhandledRejection", (reason) => {
  lastUnhandled = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  console.error("unhandledRejection swallowed", lastUnhandled);
});

const config = loadConfig();
let service: TaskService | undefined;
let appInstance: ReturnType<typeof cloudbase.init> | undefined;
const getCloudApp = (): ReturnType<typeof cloudbase.init> => {
  if (!appInstance) appInstance = cloudbase.init({ env: config.envId });
  return appInstance;
};
const getService = (): TaskService => {
  if (!service) {
    const store = new TencentCosStore(config.bucket, config.region, config.cdnBase);
    // 该体验版环境没有文档库，改为 COS JSON 文件存储。单用户短生命周期任务用不上事务/复杂查询。
    service = new TaskService(new CosRepository(store), store, config);
  }
  return service;
};

// Web clients call this function through the SDK (callFunction), which bypasses the HTTP
// access gateway. Fall back to the platform-verified SCF identity before rejecting.
const currentUser = (event: any, context: any): string => {
  try {
    return requireUser(event, context, config.allowTestIdentity);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "AUTH_REQUIRED") throw error;
    let uid: string | undefined;
    try { uid = cloudbaseContextUserId(cloudbase.getCloudbaseContext(context) as unknown as Record<string, unknown>); }
    catch { uid = undefined; }
    if (!uid) uid = userIdFromBearer(event);
    if (uid) return uid;
    throw error;
  }
};

const json = (statusCode: number, value: unknown, origin?: string) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(origin, config.allowedWebOrigins) },
  body: statusCode === 204 ? "" : JSON.stringify(value)
});

const parseBody = (event: any): any => {
  if (!event.body) return {};
  if (typeof event.body === "object") return event.body;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try { return JSON.parse(raw); } catch { throw new ApiError(400, "INVALID_JSON", "请求体必须是 JSON"); }
};

export const main = async (event: any, context: any) => {
  try {
    const method = String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
    const route = String(event.path || event.rawPath || "/").replace(/\/+$/, "") || "/";
    const requestHeaders = normalizeHeaders(event?.headers);
    const origin = requestHeaders.origin || undefined;
    requireAllowedOrigin(origin, config.allowedWebOrigins);
    const respond = (statusCode: number, value: unknown) => json(statusCode, value, origin);

    if (method === "OPTIONS") {
      requireAllowedPreflight(requestHeaders["access-control-request-method"], requestHeaders["access-control-request-headers"]);
      return respond(204, null);
    }
    const body = parseBody(event);
    if (method === "GET" && route === "/health") {
      const diag: any = { status: "ok", ts: new Date().toISOString(), storage: "cos-json" };
      const creds = loadTencentCredentials();
      diag.cos = {
        secretIdConfigured: Boolean(creds.SecretId),
        secretKeyConfigured: Boolean(creds.SecretKey),
        sessionTokenConfigured: Boolean(creds.SecurityToken),
        bucket: config.bucket,
        region: config.region,
      };
      try {
        const store = new TencentCosStore(config.bucket, config.region, config.cdnBase);
        const listProbe = async (prefix: string): Promise<Record<string, unknown>> => {
          try {
            // max 之前写死为 5，会把统计截断成最多 5 条，排查孤儿数据时严重误导（真实堆积量看不出来）。
            const keys = await store.listKeys(prefix, 1000);
            return { readable: true, count: keys.length, sample: keys.slice(0, 3) };
          } catch (e) {
            return { readable: false, error: e instanceof Error ? e.message : String(e) };
          }
        };
        diag.db = { mode: "cos-json" };
        diag.db.uploads = await listProbe("db/upload/");
        diag.db.tasks = await listProbe("db/task/");
        // 视频本体统计：孤儿视频主要堆在这两个前缀下，是存储容量的大头。
        diag.db.inputs = await listProbe("inputs/");
        diag.db.outputs = await listProbe("outputs/");
      } catch (e) {
        diag.db = { mode: "cos-json", initialized: false, error: e instanceof Error ? e.message : String(e) };
      }
      try {
        getService();
        diag.service = { built: true };
      } catch (e) {
        diag.service = { built: false, error: e instanceof Error ? e.message : String(e) };
      }
      diag.lastUnhandled = lastUnhandled;
      return respond(200, diag);
    }
    const api = getService();

    if (method === "POST" && ["/api/v1/cos-upload-tickets", "/api/v1/uploads/ticket"].includes(route)) {
      return respond(201, await api.issueUpload(currentUser(event, context), body));
    }
    let match = route.match(/^\/api\/v1\/cloud-detection-jobs\/([^/]+)$/);
    if (method === "GET" && match) {
      return respond(200, publicTask(await api.taskForUser(currentUser(event, context), decodeURIComponent(match[1]))));
    }
    // 网页端删除必须走这里：此前 History 只删 localStorage，COS 上的任务 JSON 与视频永不释放。
    match = route.match(/^\/api\/v1\/cloud-detection-jobs\/([^/]+)$/);
    if (method === "DELETE" && match) {
      return respond(200, await api.deleteTaskForUser(currentUser(event, context), decodeURIComponent(match[1])));
    }
    match = route.match(/^\/api\/v1\/detection-jobs\/([^/]+)$/);
    if (method === "GET" && match) {
      return respond(200, publicTask(await api.taskForUser(currentUser(event, context), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/detection-jobs\/([^/]+)$/);
    if (method === "DELETE" && match) {
      return respond(200, await api.deleteTaskForUser(currentUser(event, context), decodeURIComponent(match[1])));
    }
    match = route.match(/^\/api\/v1\/instant-analysis\/([^/]+)$/);
    if (method === "GET" && match) {
      return respond(200, publicTask(await api.taskForUser(currentUser(event, context), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/instant-analysis\/([^/]+)$/);
    if (method === "DELETE" && match) {
      return respond(200, await api.deleteTaskForUser(currentUser(event, context), decodeURIComponent(match[1])));
    }
    if (method === "POST" && route === "/api/v1/instant-analysis") {
      if (!body.upload_id) throw new ApiError(400, "INVALID_INPUT", "upload_id 为必填项");
      const rawContext = body.analysis_context && typeof body.analysis_context === "object" ? body.analysis_context : undefined;
      const point = rawContext && rawContext.opening_frame_point && typeof rawContext.opening_frame_point === "object" ? rawContext.opening_frame_point : undefined;
      const analysisContext = rawContext ? {
        team_name: typeof rawContext.team_name === "string" ? rawContext.team_name.slice(0, 80) : undefined,
        jersey_hint: typeof rawContext.jersey_hint === "string" ? rawContext.jersey_hint.slice(0, 160) : undefined,
        opening_frame_point: point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 ? { x: point.x, y: point.y } : undefined
      } : undefined;
      const task = await api.createInstantJob(
        currentUser(event, context),
        String(body.upload_id),
        body.client_match_id ? String(body.client_match_id) : undefined,
        analysisContext
      );
      getCloudApp()
        .callFunction({ name: "haoqiu-vlm", data: { taskId: task._id, envId: config.envId } })
        .catch((err) => console.error("haoqiu-vlm trigger failed", err instanceof Error ? err.message : err));
      return respond(202, publicTask(task));
    }

    throw new ApiError(404, "NOT_FOUND", "接口不存在");
  } catch (error) {
    const origin = normalizeHeaders(event?.headers).origin || undefined;
    if (error instanceof ApiError) return json(error.status, { error: { code: error.code, message: error.message } }, origin);
    console.error("request failed", error instanceof Error ? { name: error.name, message: error.message } : "unknown error");
    return json(500, { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } }, origin);
  }
};
