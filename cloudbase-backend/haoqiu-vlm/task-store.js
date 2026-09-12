"use strict";
const crypto = require('node:crypto');
const COLLECTION = 'haoqiu_rc_tasks';
const RC_PREFIX = 'db/rc_task/';
const CAS_MAX_ATTEMPTS = 5;
const RECOVER_SCAN_LIMIT = 200;
const stageTtl = { locating: 300, analyzing: 300, composing: 30 };
const active = ['locating', 'analyzing', 'composing'];
const millis = value => value ? new Date(value).getTime() : 0;
const fault = (code, message = code) => Object.assign(new Error(message), { code });
const one = result => Array.isArray(result.data) ? result.data[0] : result.data;

// All RC task mutations use the same database transaction boundary in API and VLM.
class TransactionTaskStore {
  constructor(db, now = () => new Date()) { this.db = db; this.now = now; }
  async get(id) { try { return one(await this.db.collection(COLLECTION).doc(id).get()) || null; } catch { throw fault('TASK_STORAGE_UNAVAILABLE'); } }
  async mutate(id, fn) {
    return this.db.runTransaction(async tx => {
      const doc = tx.collection(COLLECTION).doc(id);
      const current = one(await doc.get()) || null;
      const { value, result } = await fn(current);
      if (value) { const data = JSON.parse(JSON.stringify(value)); delete data._id; await doc.set(data); }
      return result;
    }).catch(error => { if (["TASK_NOT_FOUND","LEASE_LOST","INVALID_TRANSITION","STAGE_TIMEOUT"].includes(error.code)) throw error; throw fault("TASK_STORAGE_UNAVAILABLE"); });
  }
  create(task) {
    return this.mutate(task._id, old => old
      ? { result: { task: old, created: false } }
      : { value: task, result: { task, created: true } });
  }
  claim(id, owner, ttlSeconds = 120) {
    return this.mutate(id, task => {
      if (!task) throw fault('TASK_NOT_FOUND');
      const now = this.now(); const time = now.getTime();
      if (['succeeded', 'failed'].includes(task.status)) return { result: null };
      if (active.includes(task.status) && millis(task.lease_expires_at) > time) return { result: null };
      if (millis(task.available_at) > time) return { result: null };
      if (task.attempt >= task.max_attempts) {
        const value = { ...task, status: 'failed', stage: 'failed', error: { code: 'MAX_ATTEMPTS_EXCEEDED', message: '任务重试次数已耗尽' }, completed_at: now, updated_at: now };
        return { value, result: null };
      }
      const stage = task.analysis_context?.analysis_mode?.startsWith('personal_') ? 'locating' : 'analyzing';
      const value = { ...task, status: stage, stage, attempt: task.attempt + 1, lease_token: crypto.randomUUID(), lease_owner: owner, lease_expires_at: new Date(time + ttlSeconds * 1000), stage_started_at: now, stage_ttl_seconds: stageTtl[stage], heartbeat_at: now, updated_at: now, started_at: task.started_at || now, error: null, text_result: null };
      return { value, result: value };
    });
  }
  update(id, token, attempt, patch, ttlSeconds = 120) {
    return this.mutate(id, task => {
      const now = this.now();
      if (!task || !active.includes(task.status) || task.lease_token !== token || task.attempt !== attempt || millis(task.lease_expires_at) <= now.getTime()) throw fault('LEASE_LOST');
      const next = patch.status || task.status;
      const transitions = { locating: ['locating', 'analyzing', 'failed', 'queued'], analyzing: ['analyzing', 'composing', 'failed', 'queued'], composing: ['composing', 'succeeded', 'failed', 'queued'] };
      if (!transitions[task.status].includes(next)) throw fault('INVALID_TRANSITION');
      const stageStart = next === task.status ? task.stage_started_at : now;
      if (!['failed', 'queued'].includes(next) && now.getTime() - millis(task.stage_started_at) >= (task.stage_ttl_seconds || stageTtl[task.status]) * 1000) throw fault('STAGE_TIMEOUT');
      const value = { ...task, ...patch, status: next, stage: next, stage_started_at: stageStart, stage_ttl_seconds: stageTtl[next] || 0, updated_at: now, heartbeat_at: now, lease_expires_at: new Date(now.getTime() + ttlSeconds * 1000) };
      if (['succeeded', 'failed'].includes(next)) value.completed_at = now;
      return { value, result: value };
    });
  }
  async fail(task, error) {
    const retryable = ['MODEL_TIMEOUT', 'MODEL_NETWORK_ERROR', 'MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'STAGE_TIMEOUT'].includes(error.code);
    const retry = retryable && task.attempt < task.max_attempts;
    return this.update(task._id, task.lease_token, task.attempt, {
      status: retry ? 'queued' : 'failed', text_result: null,
      available_at: new Date(this.now().getTime() + Math.min(300, 2 ** task.attempt * 5) * 1000),
      error: { code: error.code || 'VLM_FAILED', message: retry ? '分析暂时中断，等待有限重试' : (error.code || 'VLM_FAILED') }
    });
  }
  async recover(limit = 100) {
    // Indexed bounded scans by status; the caller must schedule this entry repeatedly.
    const ids = [];
    for (const status of ['queued', ...active]) {
      const field = status === 'queued' ? 'available_at' : 'lease_expires_at';
      const result = await this.db.collection(COLLECTION).where({ status, [field]: this.db.command.lte(this.now().toISOString()) }).orderBy(field, 'asc').limit(limit).get();
      ids.push(...result.data.map(t => t._id));
    }
    return [...new Set(ids)];
  }
}
// COS compare-and-swap store. Used when the environment has no document database.
// Every mutation is a read + conditional write guarded by the object ETag, so a lost
// update is rejected with 412 instead of silently overwriting a newer attempt.
class CosCasTaskStore extends TransactionTaskStore {
  constructor(cos, config, now = () => new Date()) {
    super(null, now);
    this.cos = cos;
    this.bucket = config.bucket;
    this.region = config.region;
  }
  key(id) { return `${RC_PREFIX}${id}.json`; }
  call(method, args) {
    return new Promise((resolve, reject) =>
      this.cos[method]({ Bucket: this.bucket, Region: this.region, ...args }, (error, data) => (error ? reject(error) : resolve(data))));
  }
  async read(id) {
    let result;
    try { result = await this.call('getObject', { Key: this.key(id) }); }
    catch (error) {
      if (error && (error.statusCode === 404 || error.code === 'NoSuchKey')) return { data: null, etag: null };
      throw fault('TASK_STORAGE_UNAVAILABLE');
    }
    const body = result && result.Body;
    if (!body) return { data: null, etag: null };
    try {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      return { data: JSON.parse(text), etag: String(result.ETag || '') };
    } catch (_) { throw fault('TASK_STORAGE_UNAVAILABLE'); }
  }
  async get(id) { return (await this.read(id)).data; }
  async mutate(id, fn, attempt = 0) {
    let current;
    let outcome;
    try {
      const { data, etag } = await this.read(id);
      current = data;
      outcome = await fn(data);
      if (!outcome.value) return outcome.result;
      const body = JSON.stringify(outcome.value);
      const args = data === null
        ? { Key: this.key(id), Body: body, ContentType: 'application/json', IfNoneMatch: '*' }
        : { Key: this.key(id), Body: body, ContentType: 'application/json', IfMatch: etag };
      await this.call('putObject', args);
      return outcome.result;
    } catch (error) {
      const code = error && error.code;
      if (["TASK_NOT_FOUND", "LEASE_LOST", "INVALID_TRANSITION", "STAGE_TIMEOUT"].includes(code)) throw error;
      const status = Number((error && error.statusCode) || 0);
      const conflict = status === 412 || status === 409 || code === 'PreconditionFailed' || code === 'ConditionFailed';
      if (conflict && attempt + 1 < CAS_MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1) + Math.floor(Math.random() * 25)));
        return this.mutate(id, fn, attempt + 1);
      }
      if (conflict) throw fault('TASK_STORAGE_CONFLICT', 'task store lost a bounded compare-and-swap race');
      throw fault('TASK_STORAGE_UNAVAILABLE');
    }
  }
  async recover(limit = 100) {
    // Bounded indexed scan: list the task prefix, then filter on the stored timestamps.
    const keys = await this.listKeys();
    const time = this.now().getTime();
    const found = [];
    for (const key of keys) {
      const id = key.slice(RC_PREFIX.length).replace(/\.json$/, '');
      const { data } = await this.read(id);
      if (!data) continue;
      const eligible = ['queued', ...active];
      if (!eligible.includes(data.status)) continue;
      const field = data.status === 'queued' ? 'available_at' : 'lease_expires_at';
      const at = millis(data[field]);
      if (at <= time) found.push({ id, at });
    }
    return found.sort((a, b) => a.at - b.at).slice(0, limit).map(entry => entry.id);
  }
  async listKeys() {
    const keys = [];
    let marker = '';
    for (let page = 0; page < 20; page++) {
      const result = await this.call('getBucket', { Prefix: RC_PREFIX, MaxKeys: 1000, Marker: marker });
      for (const item of result.Contents || []) keys.push(item.Key);
      if (result.IsTruncated !== 'true' && result.IsTruncated !== true) break;
      marker = result.NextMarker || (keys.length ? keys[keys.length - 1] : '');
      if (!marker) break;
    }
    return keys.slice(0, RECOVER_SCAN_LIMIT);
  }
}

function cosCredentials() {
  return {
    SecretId: process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENT_SESSION_TOKEN
  };
}

function configuredStore() {
  const mode = process.env.TASK_STORAGE;
  if (mode === 'cloudbase-transaction') {
    if (!process.env.CLOUDBASE_ENV_ID) throw fault('CONFIGURATION_ERROR', 'CLOUDBASE_ENV_ID is required for cloudbase-transaction storage');
    const cloudbase = require('@cloudbase/node-sdk');
    return new TransactionTaskStore(cloudbase.init({ env: process.env.CLOUDBASE_ENV_ID }).database());
  }
  if (mode === 'cos-cas') {
    const bucket = process.env.COS_BUCKET;
    if (!bucket) throw fault('CONFIGURATION_ERROR', 'COS_BUCKET is required for cos-cas storage');
    const COS = require('cos-nodejs-sdk-v5');
    const credentials = cosCredentials();
    return new CosCasTaskStore(new COS(credentials), { bucket, region: process.env.COS_REGION || 'ap-shanghai' });
  }
  throw fault('CONFIGURATION_ERROR', 'TASK_STORAGE must be cloudbase-transaction or cos-cas');
}
module.exports = { TransactionTaskStore, CosCasTaskStore, configuredStore, fault, COLLECTION, RC_PREFIX };
