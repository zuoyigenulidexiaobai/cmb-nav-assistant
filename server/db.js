/**
 * SQLite 数据访问层（基于 Node 内置 node:sqlite，零 npm 依赖）。
 *
 * - 数据库文件：<DATA_DIR>/cmb.db
 * - 启动时执行 PRAGMA journal_mode=WAL，并幂等建表。
 * - product.code 统一大写去空格；nav_points.date 统一 YYYY-MM-DD。
 *
 * 版本注意：Node 22 需 `--experimental-sqlite`；Node 24+ 直接可用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/**
 * 设置项默认值。
 *
 * 定时抓取时刻的默认值取自环境变量（CMB_NAV_SCHEDULE_HOUR / _MINUTE），
 * 页面上的设置一旦保存就会覆盖它——环境变量只提供「出厂默认」。
 */
export const DEFAULT_SETTINGS = {
  threshold: 0.03,
  staleReminder: true,
  alertBelowThreshold: true,
  scheduleEnabled: true,
  scheduleHour: config.schedule.hour,
  scheduleMinute: config.schedule.minute,
};

/** 设置项的合法键集合。 */
const SETTING_KEYS = [
  'threshold',
  'staleReminder',
  'alertBelowThreshold',
  'scheduleEnabled',
  'scheduleHour',
  'scheduleMinute',
];

/** 单例数据库连接。 */
let db = null;

/**
 * 归一化产品代码：去空格 + 转大写。
 * @param {unknown} code
 * @returns {string}
 */
export function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

/**
 * 产品代码合法格式：去空格转大写后必须是 1~32 位的大写字母或数字。
 *
 * 用于阻断超长代码或含非法字符的代码入库（此前无长度上限）。
 * @type {RegExp}
 */
export const CODE_PATTERN = /^[A-Z0-9]{1,32}$/;

/**
 * 判断产品代码是否合法（先归一化再校验）。
 * @param {unknown} rawCode
 * @returns {boolean}
 */
export function isValidCode(rawCode) {
  return CODE_PATTERN.test(normalizeCode(rawCode));
}

/**
 * 获取（惰性初始化）数据库连接。
 * @returns {DatabaseSync}
 */
export function getDb() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'cmb.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  initSchema(db);
  return db;
}

/**
 * 幂等建表。
 * @param {DatabaseSync} database
 * @returns {void}
 */
function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      code       TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nav_points (
      code   TEXT NOT NULL,
      date   TEXT NOT NULL,
      nav    REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      PRIMARY KEY (code, date)
    );
    CREATE INDEX IF NOT EXISTS idx_nav_code_date ON nav_points(code, date);

    CREATE TABLE IF NOT EXISTS holdings (
      code       TEXT PRIMARY KEY,
      shares     REAL NOT NULL,
      cost_nav   REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      ok           INTEGER,
      total        INTEGER,
      updated      INTEGER,
      failed       INTEGER,
      message      TEXT,
      trigger_kind TEXT NOT NULL DEFAULT ''
    );
  `);

  // 幂等迁移：为旧库补上 trigger_kind 列（历史行取默认空串）。
  const syncLogColumns = database.prepare('PRAGMA table_info(sync_log)').all();
  const hasTriggerKind = syncLogColumns.some((col) => col.name === 'trigger_kind');
  if (!hasTriggerKind) {
    database.exec("ALTER TABLE sync_log ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT ''");
  }
}

/**
 * 当前 ISO 时间戳。
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ *
 * 产品
 * ------------------------------------------------------------------ */

/**
 * 列出全部产品（按 code 升序），active 归一化为布尔。
 * @returns {Array<{code:string,name:string,note:string,active:boolean,createdAt:string,updatedAt:string}>}
 */
export function listProducts() {
  const rows = getDb()
    .prepare('SELECT code, name, note, active, created_at, updated_at FROM products ORDER BY code')
    .all();
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    note: row.note,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * 读取单个产品。
 * @param {string} rawCode
 * @returns {object|null}
 */
export function getProduct(rawCode) {
  const code = normalizeCode(rawCode);
  const row = getDb()
    .prepare('SELECT code, name, note, active, created_at, updated_at FROM products WHERE code = ?')
    .get(code);
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    note: row.note,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 插入产品；已存在则不改动。
 * @param {string} rawCode
 * @param {{name?:string,note?:string,active?:boolean}} [extra]
 * @returns {boolean} 是否真正插入
 */
export function insertProduct(rawCode, extra = {}) {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const stamp = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO products (code, name, note, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO NOTHING`,
    )
    .run(
      code,
      String(extra.name ?? ''),
      String(extra.note ?? ''),
      extra.active === undefined ? 1 : extra.active ? 1 : 0,
      stamp,
      stamp,
    );
  return info.changes > 0;
}

/**
 * 更新产品元信息（仅更新传入字段）。
 * @param {string} rawCode
 * @param {{name?:string,note?:string,active?:boolean}} patch
 * @returns {object|null} 更新后的产品；不存在返回 null
 */
export function patchProduct(rawCode, patch = {}) {
  const code = normalizeCode(rawCode);
  const existing = getProduct(code);
  if (!existing) return null;

  const name = patch.name === undefined ? existing.name : String(patch.name);
  const note = patch.note === undefined ? existing.note : String(patch.note);
  const active = patch.active === undefined ? existing.active : Boolean(patch.active);

  getDb()
    .prepare('UPDATE products SET name = ?, note = ?, active = ?, updated_at = ? WHERE code = ?')
    .run(name, note, active ? 1 : 0, nowIso(), code);
  return getProduct(code);
}

/**
 * 删除产品及其净值点与持仓（事务）。
 * @param {string} rawCode
 * @returns {boolean} 是否存在并被删除
 */
export function deleteProduct(rawCode) {
  const code = normalizeCode(rawCode);
  const database = getDb();
  const existing = getProduct(code);
  if (!existing) return false;
  database.exec('BEGIN');
  try {
    database.prepare('DELETE FROM nav_points WHERE code = ?').run(code);
    database.prepare('DELETE FROM holdings WHERE code = ?').run(code);
    database.prepare('DELETE FROM products WHERE code = ?').run(code);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 净值点
 * ------------------------------------------------------------------ */

/**
 * 读取某产品的净值历史（按 date 升序）。
 * @param {string} rawCode
 * @returns {Array<{date:string, nav:number}>}
 */
export function listNavPoints(rawCode) {
  const code = normalizeCode(rawCode);
  const rows = getDb()
    .prepare('SELECT date, nav FROM nav_points WHERE code = ? ORDER BY date')
    .all(code);
  return rows.map((row) => ({ date: row.date, nav: Number(row.nav) }));
}

/**
 * 读取全部净值点，按产品分组。
 * @returns {Map<string, Array<{date:string, nav:number}>>}
 */
export function listAllNavPointsGrouped() {
  const rows = getDb()
    .prepare('SELECT code, date, nav FROM nav_points ORDER BY code, date')
    .all();
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.code)) map.set(row.code, []);
    map.get(row.code).push({ date: row.date, nav: Number(row.nav) });
  }
  return map;
}

/**
 * 校验净值点是否合法。
 * @param {unknown} point
 * @returns {{date:string, nav:number}|null}
 */
export function sanitizeNavPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const date = String(/** @type {any} */ (point).date ?? '').trim();
  const nav = Number(/** @type {any} */ (point).nav);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!Number.isFinite(nav) || nav <= 0) return null;
  return { date, nav };
}

/**
 * 手动录入式 upsert：同 (code,date) 直接覆盖（含 source）。
 *
 * 若目标产品不存在，则直接返回 0（不写入孤儿净值点）。
 *
 * @param {string} rawCode
 * @param {Array<{date:string,nav:number}>} points
 * @param {string} [source]
 * @returns {number} 写入条数；产品不存在时为 0
 */
export function upsertNavPoints(rawCode, points, source = 'manual') {
  const code = normalizeCode(rawCode);
  // 防御性校验：产品不存在时拒绝写入，避免产生前端不可见的孤儿净值点。
  if (!getProduct(code)) return 0;
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO nav_points (code, date, nav, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(code, date) DO UPDATE SET nav = excluded.nav, source = excluded.source`,
  );
  let saved = 0;
  database.exec('BEGIN');
  try {
    for (const raw of points) {
      const point = sanitizeNavPoint(raw);
      if (!point) continue;
      stmt.run(code, point.date, point.nav, String(source || 'manual'));
      saved += 1;
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return saved;
}

/**
 * 抓取式 upsert：同日期已存在「手动录入」点时保持不动，只更新/新增 cmb 来源的点。
 *
 * 通过 `ON CONFLICT ... DO UPDATE ... WHERE nav_points.source = 'cmb'` 实现：
 * 冲突行的 source 若不是 'cmb'，则条件不成立，更新被跳过。
 *
 * @param {string} rawCode
 * @param {Array<{date:string,nav:number}>} points
 * @returns {number} 实际写入（新增或更新）条数
 */
export function upsertCmbNavPoints(rawCode, points) {
  const code = normalizeCode(rawCode);
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO nav_points (code, date, nav, source)
     VALUES (?, ?, ?, 'cmb')
     ON CONFLICT(code, date) DO UPDATE SET nav = excluded.nav, source = 'cmb'
     WHERE nav_points.source = 'cmb'`,
  );
  let saved = 0;
  database.exec('BEGIN');
  try {
    for (const raw of points) {
      const point = sanitizeNavPoint(raw);
      if (!point) continue;
      saved += stmt.run(code, point.date, point.nav).changes;
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return saved;
}

/**
 * 导入式 upsert：同日期已存在则保持不动（幂等、不覆盖既有数据）。
 * @param {string} rawCode
 * @param {Array<{date:string,nav:number}>} points
 * @returns {number} 新增条数
 */
export function insertNavPointsIgnore(rawCode, points) {
  const code = normalizeCode(rawCode);
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO nav_points (code, date, nav, source)
     VALUES (?, ?, ?, 'manual')
     ON CONFLICT(code, date) DO NOTHING`,
  );
  let saved = 0;
  database.exec('BEGIN');
  try {
    for (const raw of points) {
      const point = sanitizeNavPoint(raw);
      if (!point) continue;
      saved += stmt.run(code, point.date, point.nav).changes;
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return saved;
}

/**
 * 删除净值点。
 * @param {string} rawCode
 * @param {Array<string>|null} [dates] 指定日期；为空则清空该产品全部净值
 * @returns {number} 删除条数
 */
export function deleteNavPoints(rawCode, dates = null) {
  const code = normalizeCode(rawCode);
  const database = getDb();
  if (Array.isArray(dates) && dates.length) {
    const stmt = database.prepare('DELETE FROM nav_points WHERE code = ? AND date = ?');
    let removed = 0;
    database.exec('BEGIN');
    try {
      for (const date of dates) {
        const text = String(date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) continue;
        removed += stmt.run(code, text).changes;
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return removed;
  }
  return database.prepare('DELETE FROM nav_points WHERE code = ?').run(code).changes;
}

/* ------------------------------------------------------------------ *
 * 持仓
 * ------------------------------------------------------------------ */

/**
 * 读取全部持仓。
 * @returns {Map<string, {shares:number, costNav:number}>}
 */
export function listHoldings() {
  const rows = getDb().prepare('SELECT code, shares, cost_nav FROM holdings').all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.code, { shares: Number(row.shares), costNav: Number(row.cost_nav) });
  }
  return map;
}

/**
 * upsert 持仓。
 * @param {string} rawCode
 * @param {number} shares
 * @param {number} costNav
 * @returns {void}
 */
export function upsertHolding(rawCode, shares, costNav) {
  const code = normalizeCode(rawCode);
  getDb()
    .prepare(
      `INSERT INTO holdings (code, shares, cost_nav, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET shares = excluded.shares, cost_nav = excluded.cost_nav, updated_at = excluded.updated_at`,
    )
    .run(code, Number(shares), Number(costNav), nowIso());
}

/**
 * 删除持仓。
 * @param {string} rawCode
 * @returns {number}
 */
export function deleteHolding(rawCode) {
  const code = normalizeCode(rawCode);
  return getDb().prepare('DELETE FROM holdings WHERE code = ?').run(code).changes;
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */

/**
 * 把任意值收敛为 [min, max] 内的整数；非法值返回兜底值。
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function toIntInRange(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/**
 * 读取设置（缺省补齐）。
 * @returns {{threshold:number, staleReminder:boolean, alertBelowThreshold:boolean,
 *   scheduleEnabled:boolean, scheduleHour:number, scheduleMinute:number}}
 */
export function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const row of rows) {
    try {
      map[row.key] = JSON.parse(row.value);
    } catch {
      /* 忽略损坏的值 */
    }
  }
  return {
    threshold:
      typeof map.threshold === 'number' && Number.isFinite(map.threshold) && map.threshold >= 0
        ? map.threshold
        : DEFAULT_SETTINGS.threshold,
    staleReminder:
      map.staleReminder === undefined ? DEFAULT_SETTINGS.staleReminder : Boolean(map.staleReminder),
    alertBelowThreshold:
      map.alertBelowThreshold === undefined
        ? DEFAULT_SETTINGS.alertBelowThreshold
        : Boolean(map.alertBelowThreshold),
    scheduleEnabled:
      map.scheduleEnabled === undefined
        ? DEFAULT_SETTINGS.scheduleEnabled
        : Boolean(map.scheduleEnabled),
    scheduleHour: toIntInRange(map.scheduleHour, DEFAULT_SETTINGS.scheduleHour, 0, 23),
    scheduleMinute: toIntInRange(map.scheduleMinute, DEFAULT_SETTINGS.scheduleMinute, 0, 59),
  };
}

/**
 * 部分更新设置，返回更新后的完整设置。
 *
 * 取值范围校验放在调用方（HTTP 路由）做，这里只落库；
 * 读取时仍会对越界值兜底，避免历史脏数据让调度器算出非法时刻。
 *
 * @param {{threshold?:number,staleReminder?:boolean,alertBelowThreshold?:boolean,
 *   scheduleEnabled?:boolean, scheduleHour?:number, scheduleMinute?:number}} patch
 * @returns {object} 更新后的完整设置
 */
export function setSettings(patch = {}) {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  for (const key of SETTING_KEYS) {
    if (patch[key] === undefined) continue;
    stmt.run(key, JSON.stringify(patch[key]));
  }
  return getSettings();
}

/* ------------------------------------------------------------------ *
 * 同步日志
 * ------------------------------------------------------------------ */

/**
 * 新建一条同步日志。
 * @param {number} total 计划抓取的产品数
 * @param {string} [triggerKind] 触发来源（manual/schedule/catchup/retry），默认 manual
 * @returns {number} 日志 id
 */
export function startSyncLog(total, triggerKind = 'manual') {
  const info = getDb()
    .prepare('INSERT INTO sync_log (started_at, total, trigger_kind) VALUES (?, ?, ?)')
    .run(nowIso(), Number(total) || 0, String(triggerKind || ''));
  return Number(info.lastInsertRowid);
}

/**
 * 结束一条同步日志。
 * @param {number} id
 * @param {{ok:boolean,total:number,updated:number,failed:number,message:string}} result
 * @returns {void}
 */
export function finishSyncLog(id, result) {
  getDb()
    .prepare(
      'UPDATE sync_log SET finished_at = ?, ok = ?, total = ?, updated = ?, failed = ?, message = ? WHERE id = ?',
    )
    .run(
      nowIso(),
      result.ok ? 1 : 0,
      Number(result.total) || 0,
      Number(result.updated) || 0,
      Number(result.failed) || 0,
      String(result.message || ''),
      id,
    );
}

/**
 * 读取最近若干条同步日志。
 * @param {number} [limit]
 * @returns {Array<object>}
 */
export function listSyncLog(limit = 20) {
  const rows = getDb()
    .prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?')
    .all(Number(limit) || 20);
  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok === null ? null : Number(row.ok) === 1,
    total: row.total === null ? null : Number(row.total),
    updated: row.updated === null ? null : Number(row.updated),
    failed: row.failed === null ? null : Number(row.failed),
    message: row.message || '',
    trigger: row.trigger_kind || '',
  }));
}

/**
 * 最近一次同步摘要（供 /api/state 的 sync 字段使用）。
 * @returns {{startedAt:string, finishedAt:string, ok:boolean|null, updated:number, failed:number, message:string, trigger:string}|null}
 */
export function getLastRun() {
  const row = getDb()
    .prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1')
    .get();
  if (!row) return null;
  return {
    startedAt: row.started_at,
    finishedAt: row.finished_at || '',
    ok: row.ok === null ? null : Number(row.ok) === 1,
    updated: Number(row.updated) || 0,
    failed: Number(row.failed) || 0,
    message: row.message || '',
    trigger: row.trigger_kind || '',
  };
}

/**
 * 读取最近一次「成功的自动抓取」的 started_at。
 *
 * 定义为：sync_log 中 trigger_kind IN ('schedule','catchup','retry') 且 ok = 1 的最新一条记录。
 * 供启动补抓判定使用；历史行（trigger_kind 为空串）不算自动抓取。
 *
 * @returns {string|null} UTC ISO 字符串；不存在返回 null
 */
export function getLastAutoRunStartedAt() {
  const row = getDb()
    .prepare(
      `SELECT started_at FROM sync_log
       WHERE ok = 1 AND trigger_kind IN ('schedule','catchup','retry')
       ORDER BY id DESC LIMIT 1`,
    )
    .get();
  return row ? row.started_at : null;
}

/* ------------------------------------------------------------------ *
 * 聚合
 * ------------------------------------------------------------------ */

/**
 * 组装前端所需的完整状态。
 * @returns {{products:Array<object>,settings:object}}
 */
export function getFullState() {
  const products = listProducts();
  const navMap = listAllNavPointsGrouped();
  const holdingMap = listHoldings();
  return {
    products: products.map((product) => ({
      code: product.code,
      name: product.name,
      note: product.note,
      active: product.active,
      holding: holdingMap.get(product.code) || null,
      history: navMap.get(product.code) || [],
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    })),
    settings: getSettings(),
  };
}

/** 读取 active=1 的产品代码列表。 */
export function listActiveCodes() {
  const rows = getDb().prepare('SELECT code FROM products WHERE active = 1 ORDER BY code').all();
  return rows.map((row) => row.code);
}
