import COS from "cos-nodejs-sdk-v5";
import { ApiError } from "./types";
import { loadTencentCredentials } from "./config";

export interface ObjectMetadata { sizeBytes: number; etag: string }
export interface ObjectStore {
  signedPutUrl(key: string, expiresSeconds: number): Promise<string>;
  signedGetUrl(key: string, expiresSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectMetadata>;
  deleteObject(key: string): Promise<void>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
/** 递归把 ISO 字符串还原为 Date，用于 JSON.parse 后的对象。 */
export function reviveDates(value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) out[k] = reviveDates((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** 把 COS 源站签名 URL 的域名换成 CDN 加速域名。
 *  签名参数（q-sign-time 等）原样保留，因此 CDN 回源时仍以源站 Host + 原签名请求，源站鉴权可正常通过。
 *  仅用于 GET 下载 URL；PUT 上传 URL 必须走源站，否则签名与路由可能失效。
 *  未配置 cdnBase 时原样返回，行为与改动前完全一致。 */
export function applyCdnDomain(url: string, cdnBase?: string): string {
  if (!cdnBase) return url;
  const base = cdnBase.replace(/\/+$/, "");
  return url.replace(/^https?:\/\/[^/]+\.cos\.[^/]*\.myqcloud\.com/i, base);
}

export class TencentCosStore implements ObjectStore {
  private client: COS;
  constructor(private bucket: string, private region: string, private cdnBase?: string) {
    const { SecretId, SecretKey, SecurityToken } = loadTencentCredentials();
    if (!SecretId || !SecretKey) throw new Error("COS runtime credentials are not configured");
    this.client = new COS({ SecretId, SecretKey, SecurityToken });
  }

  private url(method: "GET" | "PUT", key: string, expires: number): Promise<string> {
    return new Promise((resolve, reject) => this.client.getObjectUrl({
      Bucket: this.bucket, Region: this.region, Key: key, Method: method, Sign: true, Expires: expires
    }, (error, data) => error ? reject(error) : resolve(data.Url)));
  }
  signedPutUrl(key: string, expiresSeconds: number) { return this.url("PUT", key, expiresSeconds); }
  /** 下载 URL 走 CDN（若已配置）：整段视频的重复拉取收敛到边缘缓存，少付 COS 外网下行流量。 */
  signedGetUrl(key: string, expiresSeconds: number) {
    return this.url("GET", key, expiresSeconds).then((url) => applyCdnDomain(url, this.cdnBase));
  }
  head(key: string): Promise<ObjectMetadata> {
    return new Promise((resolve, reject) => this.client.headObject({ Bucket: this.bucket, Region: this.region, Key: key }, (error, data) => {
      if (error) return reject(new ApiError(409, "UPLOAD_NOT_FOUND", "尚未发现完整上传对象"));
      resolve({ sizeBytes: Number(data.headers?.["content-length"] || 0), etag: String(data.ETag || data.headers?.etag || "").replaceAll('"', "") });
    }));
  }

  /** 直接读 COS 对象为 JSON（后端内部存储用，不走签名 URL）。自动还原 ISO 日期字符串。 */
  async getJson<T = unknown>(key: string): Promise<{ data: T; etag: string } | null> {
    return new Promise((resolve, reject) => this.client.getObject(
      { Bucket: this.bucket, Region: this.region, Key: key },
      (error, data) => {
        if (error) {
          const status = Number((error as { statusCode?: number })?.statusCode ?? 0);
          if (status === 404 || (error as { code?: string })?.code === "NoSuchKey") return resolve(null);
          return reject(error);
        }
        const body = data?.Body;
        if (!body) return resolve(null);
        try {
          const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
          const etag = String(data?.ETag || data?.headers?.etag || "").replaceAll('"', "");
          resolve({ data: reviveDates(JSON.parse(text)) as T, etag });
        } catch (e) { reject(e); }
      }
    ));
  }

  /** 直接写 JSON 到 COS（后端内部存储用）。返回新对象的 ETag。 */
  async putJson(key: string, value: unknown): Promise<{ etag: string }> {
    return new Promise((resolve, reject) => this.client.putObject(
      {
        Bucket: this.bucket, Region: this.region, Key: key,
        Body: JSON.stringify(value), ContentType: "application/json"
      },
      (error, data) => {
        if (error) return reject(error);
        const etag = String(data?.ETag || "").replaceAll('"', "");
        resolve({ etag });
      }
    ));
  }

  /** 按前缀列出对象 Key（分页循环到完）。 */
  async listKeys(prefix: string, max = 1000): Promise<string[]> {
    const keys: string[] = [];
    let marker: string | undefined;
    for (;;) {
      const page = await new Promise<{ contents: Array<{ key: string }>; isTruncated: boolean; nextMarker?: string }>((resolve, reject) => this.client.getBucket(
        { Bucket: this.bucket, Region: this.region, Prefix: prefix, Marker: marker, MaxKeys: Math.min(max, 1000) },
        (error, data) => error ? reject(error) : resolve({
          contents: (data?.Contents || []).map((c: { Key: string }) => ({ key: c.Key })),
          isTruncated: Boolean(data?.IsTruncated),
          nextMarker: data?.NextMarker as string | undefined
        })
      ));
      for (const c of page.contents) keys.push(c.key);
      if (!page.isTruncated || keys.length >= max) break;
      marker = page.nextMarker ?? page.contents[page.contents.length - 1]?.key;
      if (!marker) break;
    }
    return keys;
  }

  /** 删除对象。 */
  async deleteObject(key: string): Promise<void> {
    return new Promise((resolve, reject) => this.client.deleteObject(
      { Bucket: this.bucket, Region: this.region, Key: key },
      (error) => error ? reject(error) : resolve()
    ));
  }
}
