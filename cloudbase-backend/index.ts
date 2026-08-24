import cloudbase from "@cloudbase/node-sdk";
import { normalizeHeaders, requireUser, requireWorker } from "./src/auth";
import { loadConfig } from "./src/config";
import { TencentCosStore } from "./src/cos";
import { CloudBaseRepository } from "./src/repository";
import { TaskService } from "./src/service";
import { ApiError } from "./src/types";
import type { TaskRecord } from "./src/types";
import { haiCompletionBody, publicTask, workerTask } from "./src/http-contract";

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

export const main = async (event: any, context: any) => {
  try {
    const method = String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
    const route = String(event.path || event.rawPath || "/").replace(/\/+$/, "") || "/";
    const body = parseBody(event);

    if (method === "GET" && route === "/health") return json(200, { status: "ok" });
    if (route.startsWith("/worker/") || route.startsWith("/v1/worker/")) {
      requireWorker(event, config.workerToken, config.envId);
    }
    const api = getService();

    if (method === "POST" && ["/api/v1/cos-upload-tickets", "/api/v1/uploads/ticket"].includes(route)) {
      return json(201, await api.issueUpload(requireUser(event, context, config.allowTestIdentity), body));
    }
    if (method === "POST" && route === "/api/v1/cloud-detection-jobs") {
      if (!body.upload_id || !body.client_match_id) throw new ApiError(400, "INVALID_INPUT", "upload_id 和 client_match_id 为必填项");
      return json(202, publicTask(await api.confirmUpload(
        requireUser(event, context, config.allowTestIdentity), String(body.upload_id), String(body.client_match_id)
      )));
    }
    let match = route.match(/^\/api\/v1\/uploads\/([^/]+)\/confirm$/);
    if (method === "POST" && match) {
      return json(202, publicTask(await api.confirmUpload(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/cloud-detection-jobs\/([^/]+)$/);
    if (method === "GET" && match) {
      return json(200, publicTask(await api.taskForUser(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/detection-jobs\/([^/]+)$/);
    if (method === "GET" && match) {
      return json(200, publicTask(await api.taskForUser(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1]))));
    }
    match = route.match(/^\/api\/v1\/cloud-detection-jobs\/([^/]+)\/artifacts\/annotated-video-url$/);
    if (method === "POST" && match) {
      return json(200, await api.resultUrl(requireUser(event, context, config.allowTestIdentity), decodeURIComponent(match[1])));
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

    // Canonical private contract consumed by hai-service/pull_worker/cloud_adapters.py.
    if (method === "POST" && route === "/v1/worker/tasks/claim") {
      const task = await api.claim(body);
      return task ? json(200, { task: workerTask(task) }) : json(204, null);
    }
    match = route.match(/^\/v1\/worker\/tasks\/([^/]+)\/(renew|progress|complete|fail)$/);
    if (method === "POST" && match) {
      const taskId = decodeURIComponent(match[1]);
      const action = match[2];
      let task: TaskRecord;
      if (action === "renew") task = await api.renew({ ...body, task_id: taskId });
      else if (action === "progress") task = await api.progress({ ...body, task_id: taskId });
      else if (action === "fail") task = await api.fail({ ...body, task_id: taskId });
      else {
        const idempotencyKey = normalizeHeaders(event?.headers)["idempotency-key"];
        task = await api.complete(haiCompletionBody(taskId, body, idempotencyKey));
      }
      return json(200, { accepted: true, task: workerTask(task) });
    }
    throw new ApiError(404, "NOT_FOUND", "接口不存在");
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: { code: error.code, message: error.message } });
    console.error("request failed", error instanceof Error ? { name: error.name, message: error.message } : "unknown error");
    return json(500, { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } });
  }
};
