/**
 * 「涨过头」热度评估（买前体检）核心算法
 *
 * 本模块全部为无副作用纯函数，不依赖 React，也不发起任何请求；
 * 输入是前端已有的 `product.history`（按 date 升序、仅交易日），
 * 输出是可直接用于表格展示的热度评估对象。
 *
 * 设计目标（用户原话）：
 *   「如果在我购买前，突然净值暴涨了 7 个点，那我买了以后收益增长的可能性就很低了。」
 * 因此评估的重点是「短期是否涨过头」，而不是「这只产品长期好不好」：
 *   - 近期累计涨幅越大 → 越热；
 *   - 出现单日尖峰（尤其 ≥ 2%）→ 显著加温；
 *   - 近 20 日年化远高于近 60 日年化（近期在加速）→ 加温；
 *     反之近 20 日年化明显低于近 60 日（在降温）→ 降温；
 *   - 刚创历史新高 → 轻微加温（容易在高位进场）。
 *
 * 年化口径完全复用 `src/lib/netvalue.js` 的 `findBasePoint` + `annualized`，
 * 与「概览 / 净值走势」页的算法保持一致。
 *
 * ── 权重表（满分 100，各分项先归一化到 0-100 再加权） ─────────────────────
 * 分项            权重    说明
 * cum5Score       0.28    近 5 个交易日累计涨幅，0% → 0 分，≥ 3% → 100 分（线性，可负向）
 * cum20Score      0.32    近 20 个交易日累计涨幅，0% → 0 分，≥ 8% → 100 分（线性，可负向）
 * spikeScore      0.15    尖峰分：单日尖峰幅度 / 2% 后截断到 [0,1] 再 ×100（封顶 100），
 *                         再叠加数量加成 (n-1)×20 分（最多 +30，总分仍封顶 100）；
 *                         单日 ≥ 2% 即满分基础值；无尖峰为 0 分
 * decayScore      0.15    加速分：近 20 日年化 − 近 60 日年化，
 *                         ≥ +30% → 100 分，≤ −30% → 0 分（线性）
 * newHighScore    0.10    最新净值是否为历史新高（是 = 100 分，否 = 0 分）；
 *                         仅当历史 ≥ 20 个交易日时才参与打分（样本太短不算新高）
 *
 * 加权后得到原始分，再套一层「单调平滑」保证 0-100 且两端敏感：
 *   heatScore = clamp(round(raw), 0, 100)
 * 若完全没有净值波动（区间内最大单日涨幅 < 0.05%，且 20 日累计涨幅 < 0.05%），
 * 直接判为 cold（太安静，缺乏上涨动能，买点不急）。
 *
 * ── 缺失分项的处理（历史不足时不虚高） ──────────────────────────────────
 * 拿不到的分项（例如历史 < 60 天时 decayDelta 为 null；历史 < 20 天时不计 newHigh）
 * 不按中性分白送，而是把它从分母里剔除，用其余可用分项的实际权重和重新归一化，
 * 保证「拿不到的信息既不奖励也不惩罚」。
 * 历史 < 20 个交易日时额外打 `shortHistory` 标记，并在 reasons / suggestion 里说明
 * 样本偏少、不给「等回调 / 暂缓买入」这类强结论。
 *
 * ── 分档阈值（写死，UI 只做中文映射） ───────────────────────────────────
 *   cold     : heatScore <  30
 *   normal   : 30 ≤ heatScore <  50
 *   warm     : 50 ≤ heatScore <  70
 *   hot      : 70 ≤ heatScore <  85
 *   overheat : heatScore ≥ 85
 */

import { annualized, findBasePoint } from './netvalue.js';

/** 默认尖峰阈值：单日涨幅 ≥ 1%。 */
export const DEFAULT_SPIKE_THRESHOLD = 0.01;

/** 各周期回看的交易日数量（不足时按实际天数计算）。 */
export const LOOKBACK = { d1: 1, d5: 5, d10: 10, d20: 20, d60: 60 };

/** 分档阈值（与文件头注释保持一致）。 */
export const HEAT_LEVELS = [
  { key: 'cold', min: 0, max: 30 },
  { key: 'normal', min: 30, max: 50 },
  { key: 'warm', min: 50, max: 70 },
  { key: 'hot', min: 70, max: 85 },
  { key: 'overheat', min: 85, max: Infinity },
];

/** 权重表（与文件头注释保持一致）。 */
export const HEAT_WEIGHTS = {
  cum5: 0.28,
  cum20: 0.32,
  spike: 0.15,
  decay: 0.15,
  newHigh: 0.1,
};

/** 达到满分的短期涨幅（5 日 / 20 日）。 */
const CUM5_FULL = 0.03;
const CUM20_FULL = 0.08;
/** 单日涨幅达到该值即获满额尖峰基础分。 */
const SPIKE_FULL = 0.02;
/** 年化加速差达到该值即满分 / 反之为 0 分。 */
const DECAY_FULL = 0.3;
/** 判定「太安静」的波动阈值。 */
const CALM_WAVE = 0.0005;
/** 尖峰归因中的「是近 20 日均值多少倍」阈值。 */
const SPIKE_RATIO_ALERT = 5;
/** 历史至少这么多个交易日，才把「创历史新高」计入打分。 */
const NEW_HIGH_MIN_DAYS = 20;
/** 历史少于这么多个交易日时视为「样本偏少」，打 shortHistory 且不给强结论。 */
const SHORT_HISTORY_DAYS = 20;

/**
 * 把数值限制在 [min, max] 区间。
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 线性映射到 0-100：value <= 0 → 0；value >= full → 100；中间线性。
 * @param {number} value
 * @param {number} full
 * @returns {number}
 */
function scaleTo100(value, full) {
  if (!Number.isFinite(value) || !(full > 0)) return 0;
  return clamp((value / full) * 100, 0, 100);
}

/**
 * 线性映射到 0-100，允许负值（null → 中性 50）。
 * @param {number|null} value
 * @param {number} full
 * @returns {number}
 */
function signedScaleTo100(value, full) {
  if (value === null || !Number.isFinite(value)) return 50;
  return clamp(((value + full) / (full * 2)) * 100, 0, 100);
}

/**
 * 把净值历史规范化为「按 date 升序、nav 为正数」的数组（不修改入参）。
 * @param {Array<{date:string, nav:number}>} points
 * @returns {Array<{date:string, nav:number}>}
 */
export function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => point && typeof point.date === 'string' && Number.isFinite(point.nav))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 计算相邻净值点的单日涨跌幅。
 *
 * @param {Array<{date:string, nav:number}>} points 净值点（内部会先排序）
 * @returns {Array<{date:string, nav:number, prevDate:string|null, prevNav:number|null, ret:number|null}>}
 *   `ret` 为小数字符串（0.0123 = +1.23%）；首个点 `ret` 为 null。
 */
export function dailyReturns(points) {
  const list = normalizePoints(points);
  return list.map((point, index) => {
    if (index === 0) {
      return { date: point.date, nav: point.nav, prevDate: null, prevNav: null, ret: null };
    }
    const prev = list[index - 1];
    const ret = prev.nav > 0 ? point.nav / prev.nav - 1 : null;
    return {
      date: point.date,
      nav: point.nav,
      prevDate: prev.date,
      prevNav: prev.nav,
      ret,
    };
  });
}

/**
 * 取最近 `days` 个净值点（含最新点）内的累计涨幅。
 *
 * 与「近 5 个交易日累计涨幅」语义一致：基准点为倒数第 days 个点，
 * 而不是按自然日回看；不足 days 天时使用已有全部点。
 *
 * @param {Array<{date:string, nav:number}>} points 已排序净值点
 * @param {number} days 交易日数量
 * @returns {{ret:number|null, actualDays:number, baseDate:string|null, baseNav:number|null}}
 */
export function cumulativeReturn(points, days) {
  const list = normalizePoints(points);
  if (list.length < 2) {
    return { ret: null, actualDays: list.length, baseDate: null, baseNav: null };
  }
  const span = Math.max(1, Math.min(days, list.length - 1));
  const base = list[list.length - 1 - span];
  const latest = list[list.length - 1];
  const ret = base.nav > 0 ? latest.nav / base.nav - 1 : null;
  return { ret, actualDays: span, baseDate: base.date, baseNav: base.nav };
}

/**
 * 用 netvalue 的口径计算年化（按自然日回看）。
 * @param {Array<{date:string, nav:number}>} points 已排序净值点
 * @param {number} days 自然日天数
 * @returns {number} 年化收益率（小数）；不足基准时返回 NaN
 */
export function annualizedByDays(points, days) {
  const list = normalizePoints(points);
  if (list.length < 2) return NaN;
  const latest = list[list.length - 1];
  const info = findBasePoint(list, latest, days);
  if (!info) return NaN;
  return annualized(latest.nav, info.base.nav, info.actualDays);
}

/**
 * 依据 heatScore 映射分档。
 * @param {number} score 0-100
 * @returns {'cold'|'normal'|'warm'|'hot'|'overheat'}
 */
export function heatLevelOf(score) {
  const value = clamp(Number(score), 0, 100);
  for (const level of HEAT_LEVELS) {
    if (value >= level.min && value < level.max) return level.key;
  }
  return 'overheat';
}

/**
 * 是否属于「需要提示谨慎买入」的档位。
 * @param {string} level
 * @returns {boolean}
 */
export function isHotLevel(level) {
  return level === 'hot' || level === 'overheat';
}

/**
 * 构造一张「无数据」的空评估对象，保证调用方拿到的字段齐全。
 * @param {object} product
 * @returns {object}
 */
function emptyEvaluation(product) {
  return {
    code: String(product?.code || ''),
    name: String(product?.name || ''),
    hasHolding: Boolean(product?.holding),
    latestDate: null,
    latestNav: null,
    days: 0,
    cum1: null,
    cum5: null,
    cum10: null,
    cum20: null,
    cum60: null,
    days1: 0,
    days5: 0,
    days10: 0,
    days20: 0,
    days60: 0,
    maxDaily: null,
    spikeDays: [],
    spikeThreshold: DEFAULT_SPIKE_THRESHOLD,
    annualized20: NaN,
    annualized60: NaN,
    newHigh: false,
    avgAbsRet: null,
    heatScore: 0,
    heatLevel: 'cold',
    flags: ['noData'],
    reasons: ['暂无净值数据，先在「净值管理」里录入或同步一次'],
    suggestion: '暂无数据，无法体检',
    scores: { cum5: 0, cum20: 0, spike: 0, decay: null, newHigh: 0 },
  };
}

/**
 * 单产品热度评估（纯函数）。
 *
 * @param {object} product 产品对象，需含 `code` 与 `history`
 * @param {{spikeThreshold?: number}} [options] 选项；`spikeThreshold` 默认 1%
 * @returns {object} 热度评估对象（字段见文件头与 UI 使用处）
 */
export function evaluateHeat(product, options = {}) {
  const spikeThreshold =
    Number.isFinite(options?.spikeThreshold) && options.spikeThreshold >= 0
      ? options.spikeThreshold
      : DEFAULT_SPIKE_THRESHOLD;

  const list = normalizePoints(product?.history);
  if (list.length === 0) return emptyEvaluation(product);

  const latest = list[list.length - 1];
  const identities = {
    code: String(product?.code || ''),
    name: String(product?.name || ''),
    hasHolding: Boolean(product?.holding),
  };

  // ── 1. 累计涨幅（按交易日回看） ─────────────────────────────
  const cum1 = cumulativeReturn(list, LOOKBACK.d1);
  const cum5 = cumulativeReturn(list, LOOKBACK.d5);
  const cum10 = cumulativeReturn(list, LOOKBACK.d10);
  const cum20 = cumulativeReturn(list, LOOKBACK.d20);
  const cum60 = cumulativeReturn(list, LOOKBACK.d60);

  // ── 2. 单日涨跌与尖峰 ───────────────────────────────────────
  const returns = dailyReturns(list);
  const withRet = returns.filter((item) => Number.isFinite(item.ret));

  /** @type {{date:string, ret:number}|null} */
  let maxDaily = null;
  for (const item of withRet) {
    if (!maxDaily || item.ret > maxDaily.ret) maxDaily = { date: item.date, ret: item.ret };
  }

  const spikeDays = withRet
    .filter((item) => item.ret >= spikeThreshold)
    .map((item) => ({ date: item.date, ret: item.ret }))
    .sort((a, b) => b.ret - a.ret);

  const sumAbs = withRet.reduce((sum, item) => sum + Math.abs(item.ret), 0);
  const avgAbsRet = withRet.length ? sumAbs / withRet.length : null;

  /**
   * 样本可信度 0-1：历史越短越不可信。
   *
   * 只用 2-5 个点就下「很热」的结论是没有意义的（新债/新品恰恰最常被体检），
   * 因此把短期分项按 sqrt(days / 20) 打折：
   *   3 点 → 0.39，5 点 → 0.50，10 点 → 0.71，20 点及以上 → 1（不打折）。
   * 用 sqrt 而不是线性，是为了让 10-19 天的产品仍保留大部分区分度，
   * 同时 3-5 天的产品不会被少数几个点直接推到高温档。
   */
  const confidence = Math.min(1, Math.sqrt(list.length / SHORT_HISTORY_DAYS));

  // ── 3. 年化（复用 netvalue 口径） ───────────────────────────
  const annualized20 = annualizedByDays(list, 20);
  const annualized60 = annualizedByDays(list, 60);

  // ── 4. 是否历史新高（历史 ≥ 20 个交易日才计入打分，短样本不算新高） ──
  const peak = list.reduce((best, point) => (point.nav > best ? point.nav : best), -Infinity);
  const newHigh = list.length >= NEW_HIGH_MIN_DAYS && latest.nav >= peak;
  const shortHistory = list.length < SHORT_HISTORY_DAYS;

  // ── 5. 加权打分 ────────────────────────────────────────────
  // 短期分项（5 日 / 20 日累计 + 尖峰）乘以样本可信度打折，
  // 避免「2 个点涨 2%」被当成「3 天涨 2%」一样严重。
  const cum5Score = scaleTo100(cum5.ret ?? 0, CUM5_FULL) * confidence;
  const cum20Score = scaleTo100(cum20.ret ?? 0, CUM20_FULL) * confidence;

  let spikeScore = 0;
  if (spikeDays.length > 0) {
    const strongest = spikeDays[0].ret;
    const base = clamp(strongest / SPIKE_FULL, 0, 1) * 100;
    const countBonus = Math.min(30, (spikeDays.length - 1) * 20);
    // 尖峰分同样按可信度打折：只有 3 个点里有 1 次尖峰，不足以判「很热」。
    spikeScore = clamp(Math.min(base, 100) + countBonus, 0, 100) * confidence;
  }

  const decayDelta =
    Number.isFinite(annualized20) && Number.isFinite(annualized60)
      ? annualized20 - annualized60
      : null;
  // 拿不到加速分（历史不足 60 天）时记 null，不参与加权，也不按中性 50 白送。
  const decayScore = decayDelta === null ? null : signedScaleTo100(decayDelta, DECAY_FULL);

  const newHighScore = newHigh ? 100 : 0;

  // 只对「信息可得」的分项加权；分母用实际可用权重和重新归一化，
  // 避免历史短的产品因缺失分项而虚高。
  const parts = [
    { score: cum5Score, weight: HEAT_WEIGHTS.cum5 },
    { score: cum20Score, weight: HEAT_WEIGHTS.cum20 },
    { score: spikeScore, weight: HEAT_WEIGHTS.spike },
    { score: decayScore, weight: decayScore === null ? 0 : HEAT_WEIGHTS.decay },
    { score: newHighScore, weight: newHigh ? HEAT_WEIGHTS.newHigh : 0 },
  ];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const part of parts) {
    if (!(part.weight > 0)) continue;
    weightedSum += part.score * part.weight;
    weightTotal += part.weight;
  }
  const rawScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // 太安静：几乎没有波动且短期没涨，直接判冷（user 买点不急）。
  const calmWave = Math.abs(maxDaily?.ret ?? 0) < CALM_WAVE && Math.abs(cum20.ret ?? 0) < CALM_WAVE;

  const heatScore = calmWave ? Math.min(clamp(Math.round(rawScore), 0, 100), 20) : clamp(Math.round(rawScore), 0, 100);
  const heatLevel = heatLevelOf(heatScore);

  // ── 6. 可解释的中文原因与结论 ─────────────────────────────
  const flags = [];
  const reasons = [];

  if (spikeDays.length > 0) flags.push('recentSpike');

  if (Number.isFinite(cum5.ret) && cum5.ret >= 0.03) {
    flags.push('shortTermOverheat');
  }
  if (Number.isFinite(cum20.ret) && cum20.ret >= 0.05) {
    if (!flags.includes('shortTermOverheat')) flags.push('shortTermOverheat');
  }
  if (decayDelta !== null && decayDelta <= -0.3) flags.push('annualizedDecay');
  if (decayDelta !== null && decayDelta >= 0.3) flags.push('annualizedSurge');
  if (newHigh) flags.push('newHigh');
  if (calmWave) flags.push('calm');
  // 历史太短：分数参考性有限，UI 会在热度分旁标「样本少」。
  if (shortHistory) flags.push('shortHistory');
  if (isHotLevel(heatLevel)) flags.push('needsCaution');

  // 原因按「信息量从大到小」排列，最多取 4 条。
  if (spikeDays.length > 0) {
    const top = spikeDays[0];
    const ratio =
      Number.isFinite(avgAbsRet) && avgAbsRet > 0 ? top.ret / avgAbsRet : Number.POSITIVE_INFINITY;
    if (ratio >= SPIKE_RATIO_ALERT) {
      reasons.push(
        `${top.date} 单日涨 ${(top.ret * 100).toFixed(2)}%，是近 ${withRet.length} 日均值的 ${ratio.toFixed(
          1,
        )} 倍，涨幅明显异常`,
      );
    } else {
      reasons.push(
        `${top.date} 单日涨 ${(top.ret * 100).toFixed(2)}%，近期已有 ${spikeDays.length} 次单日涨幅超过 ${(
          spikeThreshold * 100
        ).toFixed(1)}%`,
      );
    }
  }

  if (Number.isFinite(cum5.ret) && Math.abs(cum5.ret) >= 0.01) {
    const actual = cum5.actualDays;
    reasons.push(
      `近 ${actual} 个交易日累计 ${cum5.ret > 0 ? '+' : ''}${(cum5.ret * 100).toFixed(2)}%${
        cum5.ret >= 0.03 ? '，属急涨' : ''
      }`,
    );
  }

  // 短历史时 5 日与 20 日窗口会落到同一段（actualDays 相同），
  // 这时只保留一条，避免出现两句一模一样的原因。
  if (
    Number.isFinite(cum20.ret) &&
    Math.abs(cum20.ret) >= 0.02 &&
    cum20.actualDays !== cum5.actualDays
  ) {
    reasons.push(
      `近 ${cum20.actualDays} 个交易日累计 ${cum20.ret > 0 ? '+' : ''}${(cum20.ret * 100).toFixed(2)}%`,
    );
  }

  if (flags.includes('annualizedDecay') && Number.isFinite(annualized20)) {
    reasons.push(
      `近 20 日年化 ${(annualized20 * 100).toFixed(1)}% 明显低于近 60 日 ${(
        annualized60 * 100
      ).toFixed(1)}%，短期在降温`,
    );
  } else if (flags.includes('annualizedSurge') && Number.isFinite(annualized20)) {
    reasons.push(
      `近 20 日年化 ${(annualized20 * 100).toFixed(1)}% 远高于近 60 日 ${(
        annualized60 * 100
      ).toFixed(1)}%，近期在加速`,
    );
  }

  if (newHigh && reasons.length < 4) {
    // 只有短期确实在涨（有过尖峰或 5 日累计 ≥ 1%）时，新高才值得提示；
    // 长期缓涨的产品天天新高，提示「处于高位」反而误导。
    const rising = spikeDays.length > 0 || (Number.isFinite(cum5.ret) && cum5.ret >= 0.01);
    if (rising) reasons.push('最新净值创历史新高，此刻买入处于高位');
  }

  if (calmWave && reasons.length < 4) reasons.push('近期净值波动很小，没有明显的短期上涨动能');

  // 短历史提示放在最后，保证用户知道分数为什么「看着不那么确定」。
  if (shortHistory && reasons.length < 4) {
    reasons.push(`历史仅 ${list.length} 个交易日，热度参考性有限`);
  }

  if (reasons.length === 0) {
    reasons.push('近期涨幅温和，没有出现单日尖峰');
  }

  let suggestion = '走势平稳，可正常评估';
  if (heatLevel === 'cold') suggestion = '较冷静，可分批建仓';
  else if (heatLevel === 'normal') suggestion = '偏中性，可按计划分批买入';
  else if (heatLevel === 'warm') suggestion = '偏热，谨慎追高，建议等回调';
  else if (heatLevel === 'hot') suggestion = '很热，建议等回调再买，避免在尖峰后进场';
  else suggestion = '暂缓买入，短期涨幅过大，回落风险高';

  // 样本偏少时不给「等回调 / 暂缓买入」这类强结论。
  if (shortHistory && isHotLevel(heatLevel)) {
    suggestion = `样本偏少（仅 ${list.length} 个交易日），建议结合更长历史判断`;
  }

  return {
    ...identities,
    latestDate: latest.date,
    latestNav: latest.nav,
    days: list.length,
    cum1: Number.isFinite(cum1.ret) ? cum1.ret : null,
    cum5: Number.isFinite(cum5.ret) ? cum5.ret : null,
    cum10: Number.isFinite(cum10.ret) ? cum10.ret : null,
    cum20: Number.isFinite(cum20.ret) ? cum20.ret : null,
    cum60: Number.isFinite(cum60.ret) ? cum60.ret : null,
    days1: cum1.actualDays,
    days5: cum5.actualDays,
    days10: cum10.actualDays,
    days20: cum20.actualDays,
    days60: cum60.actualDays,
    maxDaily,
    spikeDays,
    spikeThreshold,
    annualized20,
    annualized60,
    newHigh,
    avgAbsRet,
    heatScore,
    heatLevel,
    flags,
    reasons: reasons.slice(0, 4),
    suggestion,
    scores: {
      cum5: Math.round(cum5Score),
      cum20: Math.round(cum20Score),
      spike: Math.round(spikeScore),
      // 加速分不可得时为 null（不参与加权），UI 不要当作 0 或 50 展示。
      decay: decayScore === null ? null : Math.round(decayScore),
      newHigh: newHighScore,
    },
  };
}

/**
 * 批量评估并按「越冷越靠前」排序（heatScore 升序）。
 *
 * @param {Array<object>} products 产品数组
 * @param {{spikeThreshold?: number}} [options]
 * @returns {Array<object>} 热度评估数组
 */
export function rankByHeat(products, options = {}) {
  const list = Array.isArray(products) ? products : [];
  return list
    .map((product) => evaluateHeat(product, options))
    .sort((a, b) => {
      if (a.heatScore !== b.heatScore) return a.heatScore - b.heatScore;
      // 同分时：有数据的排前面，再按代码稳定排序。
      if ((b.days > 0) !== (a.days > 0)) return a.days > 0 ? -1 : 1;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
}

/**
 * 从评估数组里快速取出指定代码的热度档位映射。
 * @param {Array<object>} evaluations rankByHeat / evaluateHeat 的结果
 * @returns {Map<string, object>}
 */
export function heatMapOf(evaluations) {
  const map = new Map();
  for (const item of Array.isArray(evaluations) ? evaluations : []) {
    if (item && item.code) map.set(item.code, item);
  }
  return map;
}
