/**
 * 展示格式化工具（纯函数）。
 * 数值格式沿用插件风格：净值四位小数、收益率三位小数的百分比。
 */

const DASH = '—';

/**
 * 净值：保留 4 位小数。
 * @param {number} value
 * @returns {string}
 */
export function fmtNav(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : DASH;
}

/**
 * 收益率：百分比 + 3 位小数，正数带 `+` 号。
 * @param {number} value 小数形式（0.03 → +3.000%）
 * @returns {string}
 */
export function fmtRate(value) {
  if (!Number.isFinite(value)) return DASH;
  const percent = value * 100;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(3)}%`;
}

/**
 * 通用百分比。
 * @param {number} value 小数形式
 * @param {number} [digits=2]
 * @returns {string}
 */
export function fmtPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return DASH;
  const percent = value * 100;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(digits)}%`;
}

/**
 * 金额：千分位 + 固定小数位。
 * @param {number} value
 * @param {number} [digits=2]
 * @returns {string}
 */
export function fmtMoney(value, digits = 2) {
  if (!Number.isFinite(value)) return DASH;
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 日期（原样输出，空值给占位符）。
 * @param {string} value
 * @returns {string}
 */
export function fmtDate(value) {
  return value || DASH;
}

/**
 * 短日期：`2026-07-09` → `7-9`。
 * @param {string} value
 * @returns {string}
 */
export function fmtShortDate(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || DASH;
  return `${Number(match[2])}-${Number(match[3])}`;
}

/**
 * 时间戳：`2026-07-09T12:00:00` → `2026-07-09 12:00:00`。
 * @param {string} value
 * @returns {string}
 */
export function fmtDateTime(value) {
  if (!value) return DASH;
  return String(value).replace('T', ' ');
}

/** Asia/Shanghai 相对 UTC 的偏移（UTC+8，无夏令时）。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 把 UTC ISO 时间戳格式化为北京时间 `YYYY-MM-DD HH:mm`。
 *
 * 服务端存的都是 UTC ISO，直接用 fmtDateTime 截断会早 8 小时，
 * 因此凡是展示「上次同步 / 下次抓取」这类时间都用本函数。
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function fmtBeijingDateTime(iso) {
  if (!iso) return DASH;
  const ms = Date.parse(String(iso));
  if (!Number.isFinite(ms)) return DASH;
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/**
 * 数字或 `—`。
 * @param {number} value
 * @returns {string}
 */
export function fmtCount(value) {
  return Number.isFinite(value) ? String(value) : DASH;
}

/**
 * 依据涨跌给出语义 kls 名（涨红跌绿）。
 * @param {number} value
 * @returns {'text-profit'|'text-loss'|'text-muted'}
 */
export function trendClass(value) {
  if (!Number.isFinite(value) || value === 0) return 'text-muted';
  return value > 0 ? 'text-profit' : 'text-loss';
}

/**
 * 带正负号的短日期：`2026-10-16` → `10-16`，空值给 `—`。
 *
 * 与 `fmtShortDate` 的区别：本函数对 `null / undefined / ''` 一律返回 `—`，
 * 便于在表格的括号里直接拼接（例如 `+2.31%（10-16）`）。
 *
 * @param {string|null|undefined} value ISO 日期
 * @returns {string}
 */
export function fmtMonthDay(value) {
  if (!value) return DASH;
  return fmtShortDate(value);
}

/**
 * 涨跌箭头：涨 `▲`、跌 `▼`、平 `—`。
 * @param {number} value 小数形式
 * @returns {string}
 */
export function trendArrow(value) {
  if (!Number.isFinite(value) || value === 0) return '—';
  return value > 0 ? '▲' : '▼';
}

/**
 * 把 0-100 的分数截断为整数并带上限保护。
 * @param {number} value
 * @returns {number}
 */
export function fmtScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
