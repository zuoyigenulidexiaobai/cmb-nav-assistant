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
