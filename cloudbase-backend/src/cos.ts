import COS from "cos-nodejs-sdk-v5";
import { ApiError } from "./types";

export interface ObjectMetadata { sizeBytes: number; etag: string }
export interface ObjectStore {
  signedPutUrl(key: string, expiresSeconds: number): Promise<string>;
  signedGetUrl(key: string, expiresSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectMetadata>;
}

export class TencentCosStore implements ObjectStore {
  private client: COS;
  constructor(private bucket: string, private region: string) {
    const SecretId = process.env.TENCENT_SECRET_ID;
    const SecretKey = process.env.TENCENT_SECRET_KEY;
    const SecurityToken = process.env.TENCENT_SESSION_TOKEN;
    if (!SecretId || !SecretKey) throw new Error("COS runtime credentials are not configured");
    this.client = new COS({ SecretId, SecretKey, SecurityToken });
  }

  private url(method: "GET" | "PUT", key: string, expires: number): Promise<string> {
    return new Promise((resolve, reject) => this.client.getObjectUrl({
      Bucket: this.bucket, Region: this.region, Key: key, Method: method, Sign: true, Expires: expires
    }, (error, data) => error ? reject(error) : resolve(data.Url)));
  }
  signedPutUrl(key: string, expiresSeconds: number) { return this.url("PUT", key, expiresSeconds); }
  signedGetUrl(key: string, expiresSeconds: number) { return this.url("GET", key, expiresSeconds); }
  head(key: string): Promise<ObjectMetadata> {
    return new Promise((resolve, reject) => this.client.headObject({ Bucket: this.bucket, Region: this.region, Key: key }, (error, data) => {
      if (error) return reject(new ApiError(409, "UPLOAD_NOT_FOUND", "尚未发现完整上传对象"));
      resolve({ sizeBytes: Number(data.headers?.["content-length"] || 0), etag: String(data.ETag || data.headers?.etag || "").replaceAll('"', "") });
    }));
  }
}
