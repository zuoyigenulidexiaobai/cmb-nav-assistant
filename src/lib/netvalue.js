/**
 * 净值与年化收益率核心算法
 *
 * 本模块与 Chrome 插件「招行理财净值助手 v0.1.2」中 `cmb.js` 的算法逐位一致：
 *   - daysBetween：以 UTC 零点相减后四舍五入取整天数
 *   - findBasePoint：目标日 = 最新日 - days，取「日期 <= 目标日」中日期最大的点
 *   - annualized：Math.pow(latest / base, 365 / actualDays) - 1
 *   - PERIODS：近 1 周 / 近 2 周 / 近 4 周（7 / 14 / 28 天）
 *
 * 全部为无副作用纯函数。
 */

import {
  addDaysIso,
  toDate,
  isoDate,
  isBusinessDay,
  previousBusinessDay,
} from './holidays.js';

/** 默认告警阈值：3%。 */
export const DEFAULT_THRESHOLD = 0.03;

/** 年化计算周期定义（与插件一致）。 */
export const PERIODS = [
  { key: 'oneWeek', label: '近 1 周', days: 7 },
  { key: 'twoWeeks', label: '近 2 周', days: 14 },
  { key: 'fourWeeks', label: '近 4 周', days: 28 },
];

/**
 * 计算 (a - b) 的整天数（UTC 归一化，避免夏令时误差）。
 * @param {Date|string} a
 * @param {Date|string} b
 * @returns {number} 整天数；非法输入返回 NaN
 */
export function daysBetween(a, b) {
  const dateA = toDate(a);
  const dateB = toDate(b);
  if (!dateA || !dateB) return NaN;
  const one = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
  const two = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
  return Math.round((one - two) / 86400000);
}

/**
 * 在 `latest` 之前 days 天范围内寻找基准点。
 *
 * target = latest.date 往前 days 天；
 * candidates = points 中 date <= target 的点；
 * 若无候选返回 null，否则取 date 最大的点，并给出与 latest 的实际天数差。
 *
 * @param {Array<{date: string, nav: number}>} points 按 date 升序的历史净值点
 * @param {{date: string, nav: number}|null} latest 最新净值点
 * @param {number} days 回看天数
 * @returns {{base: {date: string, nav: number}, actualDays: number}|null}
 */
export function findBasePoint(points, latest, days) {
  if (!latest || !Array.isArray(points)) return null;
  const target = addDaysIso(latest.date, -days);
  if (!target) return null;
  // ISO 日期字符串按字典序比较即等价于按时间比较。
  const candidates = points.filter((point) => point.date <= target);
  if (!candidates.length) return null;
  const base = candidates.reduce((best, point) =>
    point.date > best.date ? point : best,
  );
  return { base, actualDays: daysBetween(latest.date, base.date) };
}

/**
 * 计算年化收益率。
 *
 * @param {number} latestNav 最新净值
 * @param {number} baseNav 基准净值
 * @param {number} actualDays 实际天数
 * @returns {number} 年化收益率；actualDays <= 0 或输入非法时返回 NaN
 */
export function annualized(latestNav, baseNav, actualDays) {
  if (!(actualDays > 0)) return NaN;
  if (!(latestNav > 0) || !(baseNav > 0)) return NaN;
  return Math.pow(latestNav / baseNav, 365 / actualDays) - 1;
}

/**
 * 对单只产品做年化评估（纯函数）。
 *
 * @param {object} product 产品对象（含 history: NavPoint[]）
 * @param {string} expectedDisclosureDate 应披露日（YYYY-MM-DD）
 * @param {number} [threshold] 告警阈值，默认 3%
 * @returns {object} 评估结果
 */
export function evaluateProduct(product, expectedDisclosureDate, threshold = DEFAULT_THRESHOLD) {
  const history = Array.isArray(product?.history)
    ? product.history
        .filter((point) => point && point.date)
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    : [];

  const identity = {
    code: product?.code || '',
    name: product?.name || '',
    note: product?.note || '',
  };

  if (history.length === 0) {
    return {
      ...identity,
      status: 'nodata',
      latestNav: null,
      latestDate: null,
      periods: { oneWeek: null, twoWeeks: null, fourWeeks: null },
      underThreshold: false,
      stale: false,
      messages: ['暂无净值数据，请先录入'],
    };
  }

  const latest = history[history.length - 1];
  const periods = {};
  const messages = [];
  let underThreshold = false;

  for (const period of PERIODS) {
    const info = findBasePoint(history, latest, period.days);
    if (!info) {
      periods[period.key] = null;
      messages.push(`历史净值不足，无法计算 ${period.days} 天年化`);
      continue;
    }
    const rate = annualized(latest.nav, info.base.nav, info.actualDays);
    const under = rate < threshold;
    underThreshold = underThreshold || under;
    periods[period.key] = {
      rate,
      underThreshold: under,
      baseDate: info.base.date,
      baseNav: info.base.nav,
      actualDays: info.actualDays,
    };
  }

  const latestDate = latest.date;
  const stale = Boolean(expectedDisclosureDate) && latestDate < expectedDisclosureDate;
  if (stale) messages.push('净值未更新到最近应披露日');

  return {
    ...identity,
    status: 'ok',
    latestNav: latest.nav,
    latestDate,
    periods,
    underThreshold,
    stale,
    messages,
  };
}

/**
 * 生成整份监控报告（纯函数）。
 *
 * 与插件差异（已在 README 说明）：插件在非工作日会返回空结果并跳过；
 * 网页版始终计算，仅通过 `businessDay` 标记当前是否为工作日，
 * 以保证用户任何时间打开都能看到数据。
 *
 * @param {Array<object>} products 全部产品
 * @param {{threshold?: number}} [settings] 设置
 * @param {Date|string} [now] 当前时间（便于测试注入）
 * @returns {object} 报告
 */
export function buildReport(products, settings = {}, now = new Date()) {
  const threshold =
    typeof settings?.threshold === 'number' ? settings.threshold : DEFAULT_THRESHOLD;
  const reference = toDate(now) || new Date();
  const businessDay = isBusinessDay(reference);
  const disclosure = previousBusinessDay(reference);
  const expectedDisclosureDate = disclosure ? isoDate(disclosure) : '';

  const list = (Array.isArray(products) ? products : []).filter((item) => item && item.active);
  const results = list.map((item) =>
    evaluateProduct(item, expectedDisclosureDate, threshold),
  );

  return {
    queryTime: new Date(reference).toISOString().slice(0, 19),
    businessDay,
    expectedDisclosureDate,
    threshold,
    products: results,
  };
}

/**
 * 汇总报告的统计指标。
 * @param {object} report buildReport 的返回值
 * @returns {{total:number, updated:number, underThreshold:number, stale:number, nodata:number}}
 */
export function summarizeReport(report) {
  const list = Array.isArray(report?.products) ? report.products : [];
  return {
    total: list.length,
    updated: list.filter((item) => item.latestDate === report.expectedDisclosureDate).length,
    underThreshold: list.filter((item) => item.underThreshold).length,
    stale: list.filter((item) => item.stale).length,
    nodata: list.filter((item) => item.status === 'nodata').length,
  };
}
