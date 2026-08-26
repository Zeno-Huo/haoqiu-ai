"use strict";

const cloudbase = require("@cloudbase/node-sdk");
const COS = require("cos-nodejs-sdk-v5");

const CONFIRMATION = "haoqiu-init-v1";
const COLLECTIONS = ["haoqiu_uploads", "haoqiu_detection_tasks"];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function origins() {
  return [...new Set(
    env("ALLOWED_WEB_ORIGIN")
      .split(/[,;]/)
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function runtimeCredentials() {
  return {
    SecretId: env("TENCENTCLOUD_SECRETID", env("TENCENT_SECRET_ID")),
    SecretKey: env("TENCENTCLOUD_SECRETKEY", env("TENCENT_SECRET_KEY")),
    SecurityToken: env(
      "TENCENTCLOUD_SESSIONTOKEN",
      env("TENCENT_SESSION_TOKEN", env("TENCENT_TOKEN")),
    ),
  };
}

function isAlreadyExists(error) {
  const message = String(error && (error.message || error.code || error));
  return /already exists|exist|duplicate/i.test(message);
}

async function ensureCollections(db) {
  const results = [];
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      results.push({ name, status: "created" });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      results.push({ name, status: "exists" });
    }
  }
  return results;
}

async function configureCors() {
  const credentials = runtimeCredentials();
  if (!credentials.SecretId || !credentials.SecretKey) {
    throw new Error("Cloud runtime temporary credentials are unavailable");
  }

  const cos = new COS(credentials);
  await cos.putBucketCors({
    Bucket: env("COS_BUCKET", "haoqiu-ai-media-1352817304"),
    Region: env("COS_REGION", "ap-shanghai"),
    ResponseVary: "true",
    CORSRules: [
      {
        AllowedOrigin: origins(),
        AllowedMethod: ["PUT", "GET", "HEAD"],
        AllowedHeader: ["*"],
        ExposeHeader: ["ETag"],
        MaxAgeSeconds: 600,
      },
    ],
  });
  return { status: "configured", origins: origins() };
}

exports.main = async (event = {}) => {
  if (event.confirm !== CONFIRMATION) {
    return { ok: false, error: "confirmation_required" };
  }

  const action = event.action || "all";
  if (!["all", "collections", "cors"].includes(action)) {
    return { ok: false, error: "invalid_action" };
  }

  let collections = null;
  let cors = null;
  if (action === "all" || action === "collections") {
    const app = cloudbase.init({ env: env("CLOUDBASE_ENV_ID") });
    collections = await ensureCollections(app.database());
  }
  if (action === "all" || action === "cors") {
    cors = await configureCors();
  }

  return { ok: true, collections, cors };
};
