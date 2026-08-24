import cloudbase from "@cloudbase/node-sdk";
import { requireUser, requireWorker } from "./src/auth";
import { loadConfig } from "./src/config";
import { TencentCosStore } from "./src/cos";
import { CloudBaseRepository } from "./src/repository";
import { TaskService } from "./src/service";
import { ApiError, TaskRecord } from "./src/types";

const config = loadConfig();
let service: TaskService | undefined;
const getService = (): TaskService => {
  if (!service) {
    const app = cloudbase.init({ env: config.envId });
    service = new TaskService(new CloudBaseRepository(app.database()), new TencentCosStore(config.bucket, config.region), config);
  }
  return service;
};

const json = (statusCode: number, value: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(value)
});

const parseBody = (event: any): any => {
  if (!event.body) return {};
  if (typeof event.body === "object") return event.body;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try { return JSON.parse(raw); } catch { throw new ApiError(400, "INVALID_JSON", "请求体必须是 JSON"); }
};

const publicTask = (task: TaskRecord) => ({
  job_id: task._id, client_match_id: task.client_match_id, status: ["leased", "retry_wait"].includes(task.status) ? "queued" : task.status,
  progress: task.progress, stage: task.stage, eta_seconds: task.eta_seconds ?? null,
  input: task.input, model: task.model, diagnostics: task.diagnostics, warnings: task.warnings, error: task.error,
  artifacts: task.status === "succeeded" ? { annotated_video_url: `/api/v1/detection-jobs/${task._id}/artifacts/annotated-video` } : undefined,
  created_at: task.created_at, started_at: task.started_at, completed_at: task.completed_at
});

const workerTask = (task: TaskRecord | null) => task && ({
  task_id: task._id, lease_token: task.lease_token, lease_expires_at: task.lease_expires_at,
  input_object_key: task.input_object_key, output_object_key: task.output_object_key,
  client_match_id: task.client_match_id, attempt: task.attempt, max_attempts: task.max_attempts,
  input: task.input, status: task.status, progress: task.progress, stage: task.stage
});

export const main = async (event: any, context: any) => {
  try {
    const method = String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
    const route = String(event.path || event.rawPath || "/").replace(/\/+$/, "") || "/";
    const body = parseBody(event);
    const api = getService();

    if (method === "GET" && route === "/health") return json(200, { status: "ok" });
    if (route.startsWith("/worker/")) requireWorker(event, config.workerToken);

    if (method === "POST" && route === "/api/v1/uploads/ticket") {
      return json(201, await api.issueUpload(requireUser(event, context, config.allowTestIdentity), body));
    }
    let match = route.match(/^\/api\/v1\/uploads\/([^/]+)\/confirm$/);
    if (method === "POST" && match) {
      return json(202, publicTask(await api.confirmUpload(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/detection-jobs\/([^/]+)$/);
    if (method === "GET" && match) {
      return json(200, publicTask(await api.taskForUser(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/detection-jobs\/([^/]+)\/artifacts\/annotated-video$/);
    if (method === "GET" && match) {
      return json(200, await api.resultUrl(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1])));
    }
    if (method === "POST" && route === "/worker/v1/tasks/claim") {
      const task = await api.claim(body);
      return task ? json(200, workerTask(task)) : json(204, null);
    }
    if (method === "POST" && route === "/worker/v1/tasks/renew") return json(200, workerTask(await api.renew(body)));
    if (method === "POST" && route === "/worker/v1/tasks/progress") return json(200, workerTask(await api.progress(body)));
    if (method === "POST" && route === "/worker/v1/tasks/complete") return json(200, workerTask(await api.complete(body)));
    if (method === "POST" && route === "/worker/v1/tasks/fail") return json(200, workerTask(await api.fail(body)));
    throw new ApiError(404, "NOT_FOUND", "接口不存在");
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: { code: error.code, message: error.message } });
    console.error("request failed", error instanceof Error ? { name: error.name, message: error.message } : "unknown error");
    return json(500, { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } });
  }
};
