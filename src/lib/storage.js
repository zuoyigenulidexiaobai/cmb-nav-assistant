/**
 * localStorage 持久化（读写 + 校验 + 归一化）。
 *
 * key: `cmb-nav-assistant/v1`
 *
 * 数据模型：
 *   NavPoint = { date: 'YYYY-MM-DD', nav: number }
 *   Product  = { code, name, note, active, holding, history, createdAt, updatedAt }
 *   AppState = { version: 1, products, settings }
 */

import { DEFAULT_THRESHOLD } from './netvalue.js';

/** localStorage 键名。 */
export const STORAGE_KEY = 'cmb-nav-assistant/v1';

/** 数据结构版本。 */
export const STATE_VERSION = 1;

/**
 * 新建默认状态。
 * @returns {object}
 */
export function createDefaultState() {
  return {
    version: STATE_VERSION,
    products: [],
    settings: {
      threshold: DEFAULT_THRESHOLD,
      staleReminder: true,
      alertBelowThreshold: true,
    },
  };
}

/**
 * 归一化单个净值点；非法返回 null。
 * @param {unknown} raw
 * @returns {{date:string, nav:number}|null}
 */
export function normalizeNavPoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = String(/** @type {any} */ (raw).date ?? '').trim();
  const nav = Number(/** @type {any} */ (raw).nav);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!Number.isFinite(nav) || nav <= 0) return null;
  return { date, nav };
}

/**
 * 归一化净值历史：过滤非法点、按日期升序、同日期后者覆盖前者。
 * @param {unknown} raw
 * @returns {Array<{date:string, nav:number}>}
 */
export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const map = new Map();
  for (const item of raw) {
    const point = normalizeNavPoint(item);
    if (point) map.set(point.date, point);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/**
 * 归一化持仓。
 * @param {unknown} raw
 * @returns {{shares:number, costNav:number}|null}
 */
export function normalizeHolding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shares = Number(/** @type {any} */ (raw).shares);
  const costNav = Number(/** @type {any} */ (raw).costNav);
  if (!Number.isFinite(shares) || shares < 0) return null;
  if (!Number.isFinite(costNav) || costNav <= 0) return null;
  return { shares, costNav };
}

/**
 * 归一化单个产品。
 * @param {unknown} raw
 * @param {string} [fallbackCode]
 * @returns {object}
 */
export function normalizeProduct(raw, fallbackCode = '') {
  const source = (raw && typeof raw === 'object' ? raw : {});
  const code = String(source.code || fallbackCode || '')
    .trim()
    .toUpperCase();
  const now = new Date().toISOString();
  const history = normalizeHistory(source.history ?? source.navHistory);
  return {
    code,
    name: String(source.name || '').trim(),
    note: String(source.note || '').trim(),
    active: source.active === undefined ? true : Boolean(source.active),
    holding: normalizeHolding(source.holding),
    history,
    createdAt: String(source.createdAt || now),
    updatedAt: String(source.updatedAt || now),
  };
}

/**
 * 归一化产品列表：丢弃空 code、按 code 去重、按 code 排序。
 * @param {unknown} raw
 * @returns {Array<object>}
 */
export function normalizeProductList(raw) {
  if (!Array.isArray(raw)) return [];
  const map = new Map();
  for (const item of raw) {
    const product = normalizeProduct(item);
    if (!product.code) continue;
    if (map.has(product.code)) continue;
    map.set(product.code, product);
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * 归一化设置。
 * @param {unknown} raw
 * @returns {{threshold:number, staleReminder:boolean, alertBelowThreshold:boolean}}
 */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const thresholdValue = Number(/** @type {any} */ (source).threshold);
  return {
    threshold: Number.isFinite(thresholdValue) && thresholdValue >= 0
      ? thresholdValue
      : DEFAULT_THRESHOLD,
    staleReminder:
      /** @type {any} */ (source).staleReminder === undefined
        ? true
        : Boolean(/** @type {any} */ (source).staleReminder),
    alertBelowThreshold:
      /** @type {any} */ (source).alertBelowThreshold === undefined
        ? true
        : Boolean(/** @type {any} */ (source).alertBelowThreshold),
  };
}

/**
 * 归一化整份状态。同时兼容「插件种子数据」结构（products[].navHistory）。
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== 'object') return fallback;
  const source = /** @type {any} */ (raw);
  return {
    version: STATE_VERSION,
    products: normalizeProductList(source.products),
    settings: normalizeSettings(source.settings),
  };
}

/**
 * 把插件种子数据转换为 AppState 片段。
 * @param {unknown} seed
 * @returns {Array<object>}
 */
export function productsFromSeed(seed) {
  const source = seed && typeof seed === 'object' ? /** @type {any} */ (seed) : {};
  return normalizeProductList(source.products);
}

/**
 * 从 localStorage 读取状态。
 * @returns {object}
 */
export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

/**
 * 写入 localStorage。
 * @param {object} state
 * @returns {boolean} 是否写入成功
 */
export function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清空 localStorage 中的本应用数据。
 * @returns {void}
 */
export function clearStoredState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略隐私模式下的异常 */
  }
}

/**
 * 触发浏览器下载 JSON 文件。
 * @param {string} filename
 * @param {unknown} data
 * @returns {void}
 */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
