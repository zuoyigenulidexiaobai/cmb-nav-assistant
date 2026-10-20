/**
 * 工作日 / 节假日工具
 *
 * 节假日表与 Chrome 插件「招行理财净值助手 v0.1.2」中 `cmb.js` 的 HOLIDAYS 完全一致，
 * 逻辑同样逐位照搬（非周六日 且 不在节假日表）。
 *
 * 全部为纯函数，便于单元测试。
 */

/** 2026 年节假日（与插件一致，逐条照抄）。 */
export const HOLIDAYS_2026 = [
  '2026-01-01',
  '2026-01-02',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-04-06',
  '2026-05-01',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01',
  '2026-10-02',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
];

/** 节假日集合，O(1) 查询。 */
export const HOLIDAYS = new Set(HOLIDAYS_2026);

/**
 * 数字补零到 2 位。
 * @param {number} n
 * @returns {string}
 */
export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 把 ISO 日期字符串（YYYY-MM-DD）解析为「本地零点」的 Date 对象。
 * 非 YYYY-MM-DD 或非法日期返回 null。
 * @param {string} value
 * @returns {Date|null}
 */
export function parseIsoDate(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * 把 Date 或 ISO 字符串统一转换为本地零点的 Date；非法输入返回 null。
 * @param {Date|string} value
 * @returns {Date|null}
 */
export function toDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string') return parseIsoDate(value);
  return null;
}

/**
 * 把 Date 或 ISO 字符串格式化为 YYYY-MM-DD。
 * @param {Date|string} value
 * @returns {string}
 */
export function isoDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 判断是否为工作日：非周六周日，且不在节假日表内。
 * @param {Date|string} value
 * @returns {boolean}
 */
export function isBusinessDay(value) {
  const date = toDate(value);
  if (!date) return false;
  const day = date.getDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(isoDate(date));
}

/**
 * 从给定日期往前找第一个工作日（不含给定日期当天本身）。
 * 与插件 previousBusinessDay 行为一致。
 * @param {Date|string} before
 * @returns {Date|null}
 */
export function previousBusinessDay(before) {
  const date = toDate(before);
  if (!date) return null;
  date.setDate(date.getDate() - 1);
  while (!isBusinessDay(date)) date.setDate(date.getDate() - 1);
  return date;
}

/**
 * 在给定日期基础上加减天数，返回 ISO 字符串。
 * @param {Date|string} value
 * @param {number} days
 * @returns {string}
 */
export function addDaysIso(value, days) {
  const date = toDate(value);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return isoDate(date);
}
