/**
 * 单用户口令认证。
 *
 * - 口令哈希：scrypt(password, salt, 64)，落盘 <DATA_DIR>/auth.json：
 *     { "salt": "<hex>", "hash": "<hex>", "secret": "<hex>" }
 * - 首次启动若无 auth.json：读取 CMB_NAV_PASSWORD；未设置则随机生成 12 位口令并打印。
 * - 会话 token：base64url(JSON{exp}) + '.' + HMAC-SHA256(payload, secret)，有效期 30 天。
 * - 校验哈希用 crypto.timingSafeEqual，不做明文/直接字符串比较。
 * - 传输：HttpOnly Cookie（服务器为纯 HTTP，不加 Secure）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/** 会话 Cookie 名。 */
export const COOKIE_NAME = 'cmb_session';

/** scrypt 派生密钥长度（字节）。 */
const KEY_LEN = 64;

/** 口令字符集（去掉易混淆字符）。 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 内存缓存的认证记录。 */
let cached = null;

/**
 * auth.json 绝对路径。
 * @returns {string}
 */
function authFile() {
  return path.join(config.dataDir, 'auth.json');
}

/**
 * 生成随机口令。
 * @param {number} [length]
 * @returns {string}
 */
export function generatePassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

/**
 * 读取 auth.json（带内存缓存）。
 * @returns {{salt:string, hash:string, secret:string}|null}
 */
function loadRecord() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(authFile(), 'utf8'));
    if (raw && raw.salt && raw.hash && raw.secret) {
      cached = { salt: String(raw.salt), hash: String(raw.hash), secret: String(raw.secret) };
      return cached;
    }
  } catch {
    /* 文件不存在或损坏，视为未初始化 */
  }
  return null;
}

/**
 * 使用 scrypt 派生口令密钥。
 * @param {string} password
 * @param {string} saltHex
 * @returns {Buffer}
 */
function derive(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), KEY_LEN);
}

/**
 * 加载或初始化认证记录。首次启动时生成口令哈希并落盘。
 * @param {(message:string)=>void} [log]
 * @returns {{created:boolean, generated:string}}
 */
export function initAuth(log) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  startLoginThrottleCleanup();
  const existing = loadRecord();
  if (existing) return { created: false, generated: '' };

  const salt = crypto.randomBytes(16).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');

  const envPassword = process.env.CMB_NAV_PASSWORD;
  let password = envPassword && String(envPassword).trim() ? String(envPassword) : '';
  let generated = '';
  if (!password) {
    generated = generatePassword(12);
    password = generated;
  }

  const record = { salt, hash: derive(password, salt).toString('hex'), secret };
  fs.writeFileSync(authFile(), JSON.stringify(record, null, 2), { mode: 0o600 });
  cached = record;

  if (generated) {
    log?.(`[cmb-nav] 初始登录口令: ${generated}`);
  } else {
    log?.('[cmb-nav] 已根据 CMB_NAV_PASSWORD 初始化登录口令');
  }
  return { created: true, generated };
}

/**
 * 校验口令（常量时间比较）。
 * @param {string} password
 * @returns {boolean}
 */
export function verifyPassword(password) {
  const record = loadRecord();
  if (!record) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = derive(password, record.salt);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * 重置口令：保留原 salt 与 secret（使既有会话继续有效）。
 * @param {string} newPassword
 * @returns {boolean} 是否成功
 */
export function setPassword(newPassword) {
  const record = loadRecord();
  if (!record) return false;
  const text = String(newPassword ?? '');
  if (!text.trim()) return false;
  const next = { ...record, hash: derive(text, record.salt).toString('hex') };
  fs.writeFileSync(authFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return true;
}

/* ------------------------------------------------------------------ *
 * 登录节流（防暴力破解）
 *
 * 服务器暴露在公网且使用单一共享口令，因此对登录接口做内存级节流：
 * - 按客户端 IP 统计「连续失败次数」；连续失败达到上限后锁定一段时间；
 * - 登录成功即清零该 IP 的计数；
 * - 锁定期内无论口令正确与否一律拒绝（由调用方处理）；
 * - 定期清理过期条目，避免 Map 无限增长。
 *
 * IP 取法见 clientIp()：
 * - 默认（服务直接对外）取 req.socket.remoteAddress，忽略任何客户端可伪造的头；
 * - 部署在 nginx 后面时（config.trustProxy = true）取反代覆写过的 X-Real-IP。
 * ------------------------------------------------------------------ */

/** 登录节流参数。 */
export const LOGIN_THROTTLE = {
  /** 允许的连续失败次数上限，达到即锁定。 */
  maxFailures: 5,
  /** 锁定时长：5 分钟。 */
  lockMs: 5 * 60 * 1000,
  /** 失败时的最小响应延迟，抬高爆破成本。 */
  failDelayMs: 300,
  /** 过期条目清理间隔：10 分钟。 */
  cleanupIntervalMs: 10 * 60 * 1000,
};

/**
 * 校验并归一化一个 IP 字面量。
 *
 * 只接受 IPv4 / IPv6 字面量，IPv4-mapped 形式（::ffff:1.2.3.4）统一还原成 IPv4，
 * 保证同一个客户端在直连与反代两种路径下得到同一个节流键。
 * @param {string} value
 * @returns {string} 合法则返回归一化后的地址，否则返回空串
 */
function normalizeIp(value) {
  if (typeof value !== 'string') return '';
  let ip = value.trim();
  if (!ip || ip.length > 45) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').every((seg) => Number(seg) <= 255) ? ip : '';
  }
  if (ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip)) return ip.toLowerCase();
  return '';
}

/**
 * 解析请求的客户端 IP。
 *
 * `config.trustProxy` 关闭时只用 socket 对端地址——此时任何请求头都不可信。
 * 开启时优先取反代写入的 `config.proxyIpHeader`；该头必须由反代用
 * `$remote_addr` 覆写，客户端自带的值会在反代那一层被丢弃。
 * 头缺失或格式非法时回落到 socket 地址，绝不因为少了头就把请求当成可信来源。
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function clientIp(req) {
  if (config.trustProxy) {
    const raw = req.headers[config.proxyIpHeader];
    const fromProxy = normalizeIp(Array.isArray(raw) ? raw[0] : raw);
    if (fromProxy) return fromProxy;
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * IP → { failures:number, lockedUntil:number, lastFailure:number }。
 *
 * 仅存活于内存，进程重启即清空（符合本地单实例部署的语义）。
 * @type {Map<string, {failures:number, lockedUntil:number, lastFailure:number}>}
 */
const loginFailures = new Map();

/** 清理定时器句柄（惰性启动，避免重复注册）。 */
let cleanupTimer = null;

/**
 * 清理过期条目：
 * - 锁已到期的 IP 直接移除（下次登录重新计数）；
 * - 未锁定但长期无失败记录的 IP 也移除，控制内存占用。
 * @param {number} [now]
 * @returns {void}
 */
function pruneLoginFailures(now = Date.now()) {
  for (const [ip, record] of loginFailures) {
    const lockExpired = record.lockedUntil > 0 && record.lockedUntil <= now;
    const stale = record.lockedUntil === 0 && now - record.lastFailure > LOGIN_THROTTLE.lockMs;
    if (lockExpired || stale) loginFailures.delete(ip);
  }
}

/**
 * 启动登录节流条目的定时清理（每 10 分钟一次，unref 不阻塞进程退出）。
 * @returns {void}
 */
export function startLoginThrottleCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => pruneLoginFailures(), LOGIN_THROTTLE.cleanupIntervalMs);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

/**
 * 查询某 IP 当前的锁定剩余毫秒数；顺带清理过期条目。
 * @param {string} ip
 * @returns {number} 0 表示未锁定
 */
export function getLoginLockRemaining(ip) {
  const now = Date.now();
  pruneLoginFailures(now);
  const record = loginFailures.get(ip);
  if (!record || record.lockedUntil <= now) return 0;
  return record.lockedUntil - now;
}

/**
 * 记录一次登录失败；达到上限时触发锁定。
 * @param {string} ip
 * @returns {{failures:number, lockedUntil:number}} 更新后的记录快照
 */
export function recordLoginFailure(ip) {
  const now = Date.now();
  pruneLoginFailures(now);
  const record = loginFailures.get(ip) || { failures: 0, lockedUntil: 0, lastFailure: 0 };
  record.failures += 1;
  record.lastFailure = now;
  if (record.failures >= LOGIN_THROTTLE.maxFailures) {
    record.lockedUntil = now + LOGIN_THROTTLE.lockMs;
  }
  loginFailures.set(ip, record);
  return { failures: record.failures, lockedUntil: record.lockedUntil };
}

/**
 * 登录成功后清零该 IP 的失败计数。
 * @param {string} ip
 * @returns {void}
 */
export function recordLoginSuccess(ip) {
  loginFailures.delete(ip);
}

/* ------------------------------------------------------------------ *
 * 会话 token
 * ------------------------------------------------------------------ */

/**
 * 对 payload 生成 HMAC-SHA256（base64url）。
 * @param {string} payloadB64
 * @returns {string}
 */
function sign(payloadB64) {
  const record = loadRecord();
  const secret = record ? Buffer.from(record.secret, 'hex') : Buffer.alloc(0);
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * 签发会话 token（有效期 30 天）。
 * @returns {string}
 */
export function issueToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + config.sessionMaxAgeMs }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * 校验会话 token 的签名与有效期。
 * @param {unknown} token
 * @returns {boolean}
 */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token) return false;
  const index = token.lastIndexOf('.');
  if (index <= 0) return false;
  const payload = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Cookie 工具
 * ------------------------------------------------------------------ */

/**
 * 生成 Set-Cookie 头（登录成功）。
 * @param {string} token
 * @returns {string}
 */
export function buildSessionCookie(token) {
  const maxAge = Math.floor(config.sessionMaxAgeMs / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * 生成清除会话的 Set-Cookie 头。
 * @returns {string}
 */
export function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * 解析 Cookie 头。
 * @param {string|undefined} header
 * @returns {Record<string,string>}
 */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * 从请求中取会话 token。
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function getTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || '';
}

/**
 * 请求是否已认证。
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isAuthenticated(req) {
  return verifyToken(getTokenFromRequest(req));
}
