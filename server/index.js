/**
 * HTTP 服务入口：API 路由分发 + 静态资源托管 + 启动引导。
 *
 * 仅使用 Node 内置模块（node:http / node:sqlite / node:crypto / node:fs / node:path / node:url）。
 * 单进程同时提供 /api/* 与前端构建产物（dist/），同源无跨域。
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  deleteHolding,
  deleteNavPoints,
  deleteProduct,
  getFullState,
  getProduct,
  insertNavPointsIgnore,
  insertProduct,
  isValidCode,
  listSyncLog,
  normalizeCode,
  patchProduct,
  sanitizeNavPoint,
  setSettings,
  upsertHolding,
  upsertNavPoints,
} from './db.js';
import {
  buildClearCookie,
  buildSessionCookie,
  clientIp,
  getLoginLockRemaining,
  initAuth,
  isAuthenticated,
  issueToken,
  LOGIN_THROTTLE,
  recordLoginFailure,
  recordLoginSuccess,
  verifyPassword,
} from './auth.js';
import {
  getSyncStatus,
  isNameSyncRunning,
  isRunning,
  runSync,
  startScheduler,
  syncProductNames,
} from './scheduler.js';

/** 静态资源 Content-Type 映射。 */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** 带 HTTP 状态码的业务错误。 */
class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * 写入统一 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} payload
 * @param {string[]} [extraHeaders]
 * @returns {void}
 */
function sendJson(res, status, payload, extraHeaders = []) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...collectHeaders(extraHeaders),
  });
  res.end(body);
}

/**
 * 把额外的头数组（如 Set-Cookie）合并为对象。
 * @param {string[]} list
 * @returns {Record<string,string|string[]>}
 */
function collectHeaders(list) {
  const out = {};
  const cookies = list.filter((item) => item.startsWith('cmb_session='));
  if (cookies.length) out['Set-Cookie'] = cookies;
  return out;
}

/** 成功响应。 */
function ok(res, data, extraHeaders) {
  sendJson(res, 200, { ok: true, data }, extraHeaders);
}

/** 失败响应。 */
function fail(res, status, message, extraHeaders) {
  sendJson(res, status, { ok: false, error: message }, extraHeaders);
}

/**
 * 读取请求体（带大小上限）。
 *
 * 超过上限时不立即销毁连接，而是停止累积并继续「排空」剩余数据，
 * 让上层能正常返回 413 响应（避免客户端收到 ECONNRESET）。
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return; // 已超限：丢弃后续数据
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        overflow = true;
        chunks.length = 0;
        reject(new HttpError(413, '请求体过大（上限 1MB）'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!overflow) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!overflow) reject(error);
    });
  });
}

/**
 * 读取并解析 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJson(req) {
  const buffer = await readBody(req);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON');
  }
}

/**
 * 异步睡眠。
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 校验（已归一化的）产品代码格式，非法则抛 400。
 *
 * 规则：去空格转大写后必须匹配 ^[A-Z0-9]{1,32}$（同时拦截超长与非法字符）。
 * @param {string} code 已归一化的代码
 * @returns {string} 原样返回合法代码
 */
function assertValidCode(code) {
  if (!isValidCode(code)) {
    throw new HttpError(400, '产品代码格式不合法');
  }
  return code;
}

/**
 * 断言产品存在，不存在则抛 404（不静默写入/静默成功）。
 * @param {string} code 已归一化的代码
 * @returns {object} 产品对象
 */
function assertProductExists(code) {
  const product = getProduct(code);
  if (!product) {
    throw new HttpError(404, '产品不存在');
  }
  return product;
}

/**
 * 统一安全响应头。
 * @param {import('node:http').ServerResponse} res
 * @returns {void}
 */
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/* ------------------------------------------------------------------ *
 * 静态资源
 * ------------------------------------------------------------------ */

/**
 * 探测文件状态；失败返回 null。
 * @param {string} filePath
 * @returns {Promise<import('node:fs').Stats|null>}
 */
async function statFile(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

/**
 * 判断目标路径是否安全地位于静态根目录内（防路径穿越）。
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 发送文件内容。
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 * @returns {void}
 */
function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': type });
  });
  stream.on('error', () => {
    if (!res.headersSent) fail(res, 500, '服务器内部错误');
    else res.end();
  });
  stream.pipe(res);
}

/**
 * 提供静态文件（含 SPA fallback）。
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<void>}
 */
async function serveStatic(res, pathname) {
  const root = path.resolve(config.distDir);
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname);
  } catch {
    fail(res, 400, '非法的请求路径');
    return;
  }
  if (relativePath === '/' || relativePath === '') relativePath = '/index.html';
  // 兼容 Windows 风格分隔符，避免 `..\..\` 绕过（配合下方 isInsideRoot 双保险）。
  relativePath = relativePath.replace(/\\/g, '/');

  let filePath = path.resolve(root, `.${path.normalize(relativePath)}`);
  if (!isInsideRoot(root, filePath)) {
    fail(res, 403, '禁止访问该路径');
    return;
  }

  let stat = await statFile(filePath);
  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stat = await statFile(filePath);
  }

  if (!stat || !stat.isFile()) {
    // SPA fallback：仅对不含扩展名的路径回退到 index.html。
    if (!path.extname(relativePath)) {
      filePath = path.join(root, 'index.html');
      stat = await statFile(filePath);
    }
    if (!stat || !stat.isFile()) {
      fail(res, 404, '资源不存在');
      return;
    }
  }

  sendFile(res, filePath);
}

/* ------------------------------------------------------------------ *
 * API 处理
 * ------------------------------------------------------------------ */

/**
 * 处理认证类接口（无需登录）。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleAuthRoutes(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    ok(res, { version: config.version, time: new Date().toISOString() });
    return true;
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    ok(res, { authenticated: isAuthenticated(req) });
    return true;
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    // 反代部署时取 nginx 覆写的 X-Real-IP（需 TRUST_PROXY=1），否则取 socket 对端地址。
    const ip = clientIp(req);
    if (getLoginLockRemaining(ip) > 0) {
      fail(res, 429, '尝试过于频繁，请 5 分钟后再试');
      return true;
    }
    const body = await readJson(req);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !verifyPassword(password)) {
      // 失败加最小延迟，抬高暴力破解成本。
      await sleep(LOGIN_THROTTLE.failDelayMs);
      recordLoginFailure(ip);
      fail(res, 401, '口令不正确');
      return true;
    }
    recordLoginSuccess(ip);
    ok(res, { authenticated: true }, [buildSessionCookie(issueToken())]);
    return true;
  }
  return false;
}

/**
 * 处理 import 接口。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleImport(req, res) {
  const body = await readJson(req);
  const products = Array.isArray(body.products) ? body.products : [];
  let points = 0;
  let created = 0;

  for (const raw of products) {
    if (!raw || typeof raw !== 'object') continue;
    const code = normalizeCode(raw.code);
    if (!code) continue;
    const isActive = raw.active === undefined ? true : Boolean(raw.active);
    if (insertProduct(code, { name: raw.name || '', note: raw.note || '', active: isActive })) {
      created += 1;
    } else {
      // 已存在：仅补齐空的名称，不覆盖用户自定义内容与监控状态。
      const current = getProduct(code);
      if (current && !current.name && raw.name) patchProduct(code, { name: raw.name });
    }
    const history = Array.isArray(raw.navHistory) ? raw.navHistory : [];
    points += insertNavPointsIgnore(code, history);
  }

  const thresholdValue = Number(body.threshold);
  if (Number.isFinite(thresholdValue) && thresholdValue >= 0) {
    setSettings({ threshold: thresholdValue });
  }

  const state = getFullState();
  ok(res, {
    products: state.products.length,
    points: state.products.reduce((sum, item) => sum + item.history.length, 0),
    active: state.products.filter((item) => item.active).length,
    created,
    importedPoints: points,
  });
}

/**
 * 处理需认证的业务接口。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function handleProtected(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/auth/logout' && method === 'POST') {
    ok(res, { authenticated: false }, [buildClearCookie()]);
    return;
  }

  if (pathname === '/api/state' && method === 'GET') {
    const state = getFullState();
    ok(res, { ...state, sync: getSyncStatus() });
    return;
  }

  if (pathname === '/api/products' && method === 'POST') {
    const body = await readJson(req);
    const codes = Array.isArray(body.codes) ? body.codes : [];
    const added = [];
    const skipped = [];
    const invalid = [];
    const seen = new Set();
    for (const rawCode of codes) {
      const code = normalizeCode(rawCode);
      if (!code) continue; // 空项直接忽略（视为未填写）
      if (!isValidCode(code)) {
        // 逐条过滤：非法代码不计入 added/skipped，单独归入 invalid。
        if (!invalid.includes(code)) invalid.push(code);
        continue;
      }
      if (seen.has(code)) continue;
      seen.add(code);
      if (insertProduct(code)) added.push(code);
      else skipped.push(code);
    }
    ok(res, { added, skipped, invalid });
    return;
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await readJson(req);
    const patch = {};
    if (body.threshold !== undefined) {
      const value = Number(body.threshold);
      if (!Number.isFinite(value) || value < 0) throw new HttpError(400, '阈值必须是不小于 0 的数字');
      patch.threshold = value;
    }
    if (body.staleReminder !== undefined) patch.staleReminder = Boolean(body.staleReminder);
    if (body.alertBelowThreshold !== undefined) {
      patch.alertBelowThreshold = Boolean(body.alertBelowThreshold);
    }
    ok(res, setSettings(patch));
    return;
  }

  if (pathname === '/api/sync' && method === 'POST') {
    const body = await readJson(req);
    if (isRunning()) {
      ok(res, { started: false, reason: '已有同步任务在运行' });
      return;
    }
    const codes = Array.isArray(body.codes) ? body.codes : undefined;
    runSync({ codes, trigger: 'manual' }).catch((error) => {
      console.error('[cmb-nav] 手动同步异常：', error);
    });
    sendJson(res, 202, { ok: true, data: { started: true } });
    return;
  }

  if (pathname === '/api/sync/log' && method === 'GET') {
    ok(res, { logs: listSyncLog(20), ...getSyncStatus() });
    return;
  }

  // 从招行同步产品名称。
  // 与 /api/sync（抓净值）互不阻塞：一个写净值点、一个写产品名。
  // 产品数量有限（每只 1 次请求 + 节流间隔），因此直接同步返回结果，前端无需轮询。
  if (pathname === '/api/sync/names' && method === 'POST') {
    const body = await readJson(req);
    if (isNameSyncRunning()) {
      ok(res, { started: false, reason: '已有产品名同步任务在运行' });
      return;
    }
    const codes = Array.isArray(body.codes) ? body.codes : undefined;
    const overwrite = body.overwrite !== false;
    const outcome = await syncProductNames({ codes, overwrite });
    if (!outcome.started) {
      ok(res, { started: false, reason: outcome.reason });
      return;
    }
    ok(res, { started: true, ...outcome.result });
    return;
  }

  if (pathname === '/api/import' && method === 'POST') {
    await handleImport(req, res);
    return;
  }

  const navMatch = pathname.match(/^\/api\/products\/([^/]+)\/nav$/);
  if (navMatch) {
    const code = assertValidCode(normalizeCode(navMatch[1]));
    if (method === 'POST') {
      assertProductExists(code);
      const body = await readJson(req);
      const points = Array.isArray(body.points) ? body.points : [];
      const clean = points.map((item) => sanitizeNavPoint(item)).filter(Boolean);
      if (!clean.length) {
        ok(res, { saved: 0 });
        return;
      }
      const saved = upsertNavPoints(code, clean, body.source || 'manual');
      ok(res, { saved });
      return;
    }
    if (method === 'DELETE') {
      assertProductExists(code);
      const body = await readJson(req);
      const dates = Array.isArray(body.dates) ? body.dates : null;
      const removed = deleteNavPoints(code, dates);
      ok(res, { removed });
      return;
    }
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch) {
    const code = assertValidCode(normalizeCode(productMatch[1]));
    if (method === 'PATCH') {
      const body = await readJson(req);
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name);
      if (body.note !== undefined) patch.note = String(body.note);
      if (body.active !== undefined) patch.active = Boolean(body.active);
      const updated = patchProduct(code, patch);
      if (!updated) throw new HttpError(404, `产品 ${code} 不存在`);
      ok(res, updated);
      return;
    }
    if (method === 'DELETE') {
      const removed = deleteProduct(code);
      if (!removed) throw new HttpError(404, `产品 ${code} 不存在`);
      ok(res, { removed: true });
      return;
    }
  }

  const holdingMatch = pathname.match(/^\/api\/holdings\/([^/]+)$/);
  if (holdingMatch && method === 'PUT') {
    const code = assertValidCode(normalizeCode(holdingMatch[1]));
    assertProductExists(code);
    const body = await readJson(req);
    const shares = Number(body.shares);
    const costNav = Number(body.costNav);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(costNav) || costNav <= 0) {
      deleteHolding(code);
      ok(res, { holding: null });
      return;
    }
    upsertHolding(code, shares, costNav);
    ok(res, { holding: { shares, costNav } });
    return;
  }

  throw new HttpError(404, '接口不存在');
}

/**
 * 请求总入口。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleRequest(req, res) {
  applySecurityHeaders(res);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (!pathname.startsWith('/api/')) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(res, pathname);
      return;
    }
    fail(res, 405, '不支持的请求方法');
    return;
  }

  try {
    if (await handleAuthRoutes(req, res, pathname)) return;

    if (!isAuthenticated(req)) {
      fail(res, 401, '未登录或会话已过期');
      return;
    }

    await handleProtected(req, res, url);
  } catch (error) {
    if (error instanceof HttpError) {
      fail(res, error.status, error.message);
      return;
    }
    console.error('[cmb-nav] 处理请求出错：', error);
    fail(res, 500, '服务器内部错误');
  }
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

/** 打印启动日志。 */
function log(message) {
  console.log(message);
}

/**
 * 创建并启动服务。
 * @returns {import('node:http').Server}
 */
export function createServer() {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('[cmb-nav] 未捕获异常：', error);
      if (!res.headersSent) fail(res, 500, '服务器内部错误');
      else res.end();
    });
  });
  return server;
}

/** 启动流程：初始化认证与数据库 → 监听端口 → 启动定时器。 */
function bootstrap() {
  const authInfo = initAuth(log);
  if (!authInfo.created) {
    log('[cmb-nav] 已加载现有登录口令（auth.json）');
  }
  log(`[cmb-nav] 数据目录: ${config.dataDir}`);
  log(`[cmb-nav] 静态目录: ${config.distDir}`);

  const server = createServer();
  server.listen(config.port, config.host, () => {
    log(
      `[cmb-nav] 服务已启动: http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port} （监听 ${config.host}:${config.port}）`,
    );
  });

  startScheduler(log);

  const shutdown = () => {
    log('[cmb-nav] 正在关闭服务…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

bootstrap();
