/**
 * 定时抓取调度 + 抓取任务执行。
 *
 * - 每天 09:00（Asia/Shanghai，可经 CMB_NAV_SCHEDULE_HOUR / CMB_NAV_SCHEDULE_MINUTE 覆盖）
 *   抓取一次全部 active=1 的产品。
 * - 通过 setTimeout 递归计算「距下次执行的毫秒数」，避免 setInterval 的累积漂移。
 * - 启动时做 catch-up：若今日已过抓取时刻、且今日尚无成功的自动抓取，则立即补抓一轮
 *   （不阻塞服务启动），并把下次定时器指向明天 09:00。
 * - 定时（schedule）/补抓（catchup）若本轮有产品失败，进入后台重试循环（最多 2 轮，
 *   延迟可经 CMB_NAV_RETRY_DELAY_MS 覆盖）；手动触发不自动重试。
 * - 全局互斥：同一时刻只允许一个抓取任务运行（定时与手动共用）；重试等待期间不占用该互斥标志。
 */

import { config } from './config.js';
import {
  finishSyncLog,
  getLastAutoRunStartedAt,
  getLastRun,
  getProduct,
  listActiveCodes,
  listProducts,
  patchProduct,
  startSyncLog,
  upsertCmbNavPoints,
} from './db.js';
import { fetchNavPoints, fetchProductName } from './cmb.js';

/** Asia/Shanghai 相对 UTC 的偏移（UTC+8，无夏令时）。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** trigger → 中文标签映射（仅用于 sync_log.message 的本地化展示）。 */
const TRIGGER_LABELS = {
  manual: '手动',
  schedule: '定时',
  catchup: '启动补抓',
  retry: '失败重试',
};

/** 同步互斥标志。 */
let running = false;

/** 产品名同步互斥标志（与净值抓取相互独立，互不阻塞）。 */
let namesRunning = false;

/** 当前定时器句柄。 */
let timer = null;

/** 待执行的重试定时器句柄。 */
let retryTimer = null;

/** 失败重试循环互斥标志（同一时间只允许一个重试循环）。 */
let retryLoopActive = false;

/** 调度器日志函数（由 startScheduler 注入；供补抓与重试日志使用）。 */
let logger = null;

/**
 * 异步睡眠。
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 输出一条调度日志：优先走注入的日志函数，否则退回 console。
 * @param {string} message
 * @returns {void}
 */
function emitLog(message) {
  if (typeof logger === 'function') logger(message);
  else console.log(message);
}

/**
 * trigger 文案本地化。
 * @param {string} trigger 触发来源（manual/schedule/catchup/retry）
 * @returns {string} 中文标签；未知值原样返回
 */
function triggerLabel(trigger) {
  const key = String(trigger || '').trim();
  return TRIGGER_LABELS[key] || key;
}

/**
 * 定时抓取时刻的展示文案（HH:MM，Asia/Shanghai）。
 * @returns {string}
 */
function scheduleTimeText() {
  const hh = String(config.schedule.hour).padStart(2, '0');
  const mm = String(config.schedule.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 当前是否正在同步。
 * @returns {boolean}
 */
export function isRunning() {
  return running;
}

/**
 * 计算上海自然日键（YYYY-MM-DD）。
 *
 * 纯函数：仅做时区换算，不访问数据库或网络。
 *
 * @param {number|string} msOrIso 毫秒时间戳或 ISO 时间字符串
 * @returns {string} 上海本地日期键；入参非法时返回空串
 */
export function shanghaiDayKey(msOrIso) {
  const ms = typeof msOrIso === 'number' ? msOrIso : Date.parse(String(msOrIso));
  if (!Number.isFinite(ms)) return '';
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS); // 使 UTC 字段即等于上海挂钟时间
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 距下一次定时抓取时刻（Asia/Shanghai）的毫秒数。
 *
 * 纯函数：仅做时间换算，不访问数据库或网络。
 *
 * @param {number} [now] 当前毫秒时间戳，默认 Date.now()
 * @returns {number} 距下次执行的毫秒数（严格大于 0）
 */
export function msUntilNextRun(now = Date.now()) {
  const current = Number.isFinite(now) ? now : Date.now();
  const shifted = current + SHANGHAI_OFFSET_MS; // 使 UTC 字段即等于上海挂钟时间
  const date = new Date(shifted);
  let target = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    config.schedule.hour,
    config.schedule.minute,
    0,
    0,
  );
  if (target <= shifted) target += 24 * 60 * 60 * 1000;
  return target - shifted;
}

/**
 * 是否需要在启动时补抓今日尚未执行的定时抓取。
 *
 * 判据（均以 Asia/Shanghai 自然日为准）：
 *   - 当前上海挂钟时间已过今日抓取时刻；
 *   - 且最近一次「成功的自动抓取」（schedule/catchup/retry 且 ok=1）不在今日。
 *
 * 纯函数：不访问数据库或网络；lastAutoRunStartedAt 由调用方查库后提供。
 *
 * @param {number|string} now 当前毫秒时间戳或 ISO 字符串
 * @param {string|null} lastAutoRunStartedAt 最近一次成功自动抓取的 started_at（UTC ISO 字符串或 null）
 * @returns {boolean}
 */
export function shouldCatchUp(now, lastAutoRunStartedAt) {
  const nowMs = typeof now === 'number' ? now : Date.parse(String(now));
  if (!Number.isFinite(nowMs)) return false;

  const shifted = nowMs + SHANGHAI_OFFSET_MS; // 使 UTC 字段即等于上海挂钟时间
  const date = new Date(shifted);
  const target = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    config.schedule.hour,
    config.schedule.minute,
    0,
    0,
  );
  // 未到今日抓取时刻 → 不需要补抓
  if (shifted < target) return false;
  // 今日尚无成功的自动抓取 → 需要补抓
  if (!lastAutoRunStartedAt) return true;
  // 最近一次成功自动抓取就在今日 → 无需补抓（跨日/昨天成功则需补抓）
  return shanghaiDayKey(lastAutoRunStartedAt) !== shanghaiDayKey(nowMs);
}

/**
 * 仅当本地名称为空时，用招行返回的名称回填。
 *
 * 抓取是隐式动作，因此采取保守策略：绝不覆盖已有名称（可能是用户手填的简称），
 * 只补「未命名产品」。需要以招行为准全量纠正时，走显式的 syncProductNames()。
 *
 * @param {string} code
 * @param {string} name 招行返回的名称
 * @returns {boolean} 是否写入了名称
 */
function backfillName(code, name) {
  const text = String(name || '').trim();
  if (!text) return false;
  const product = getProduct(code);
  if (!product) return false;
  if (String(product.name || '').trim()) return false;
  patchProduct(code, { name: text });
  return true;
}

/**
 * 抓取单个产品（含 2 次重试，指数退避）。
 * @param {string} code
 * @returns {Promise<{ok:boolean, saved:number, points:number, named:boolean, error:string}>}
 */
async function syncOne(code) {
  const backoffs = config.cmb.retryBackoffMs;
  let lastError = '';
  for (let attempt = 0; attempt <= backoffs.length; attempt += 1) {
    try {
      const { points, name } = await fetchNavPoints(code, { days: config.defaultLookbackDays });
      const saved = upsertCmbNavPoints(code, points);
      // 抓取请求本就会查询产品信息，名称是「顺带拿到」的，零额外开销。
      const named = backfillName(code, name);
      return { ok: true, saved, points: points.length, named, error: '' };
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      if (attempt < backoffs.length) await sleep(backoffs[attempt]);
    }
  }
  return { ok: false, saved: 0, points: 0, named: false, error: lastError || '抓取失败' };
}

/**
 * 等待一个可被 stopScheduler() 取消的重试延迟。
 * @param {number} ms
 * @returns {Promise<void>}
 */
function waitRetryDelay(ms) {
  return new Promise((resolve) => {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      resolve();
    }, ms);
    if (typeof retryTimer.unref === 'function') retryTimer.unref();
  });
}

/**
 * 失败自动重试循环（最多 config.retryDelaysMs.length 轮，逐轮缩小失败集）。
 *
 * - 等待期间不占用全局互斥标志（running 保持 false），因此不阻塞手动抓取。
 * - 每轮重试都会调用 runSync 写一条独立的 sync_log（trigger_kind = 'retry'）。
 * - 若某轮重试启动时 running === true（有其他抓取任务在跑），本轮跳过并继续尝试下一轮。
 *
 * @param {string[]} initialCodes 首轮重试的产品代码
 * @returns {Promise<void>}
 */
async function runRetryLoop(initialCodes) {
  if (retryLoopActive) {
    emitLog('[cmb-nav] 已有失败重试循环进行中，本次不再启动新的重试循环');
    return;
  }
  retryLoopActive = true;
  let codes = Array.isArray(initialCodes) ? initialCodes.slice() : [];
  const delays = Array.isArray(config.retryDelaysMs) ? config.retryDelaysMs : [];
  try {
    for (let round = 0; round < delays.length; round += 1) {
      if (codes.length === 0) break;
      const delay = delays[round];
      emitLog(
        `[cmb-nav] 将在约 ${Math.round(delay / 60000)} 分钟后进行第 ${round + 1} 轮失败重试（${codes.join('、')}）`,
      );
      // eslint-disable-next-line no-await-in-loop
      await waitRetryDelay(delay);
      if (running) {
        emitLog(
          `[cmb-nav] 第 ${round + 1} 轮失败重试启动时检测到其他抓取任务在运行，本轮跳过（${codes.join('、')}）`,
        );
        continue;
      }
      emitLog(`[cmb-nav] 开始第 ${round + 1} 轮失败重试：${codes.join('、')}`);
      // eslint-disable-next-line no-await-in-loop
      const { result } = await runSync({ codes, trigger: 'retry' });
      codes = result && Array.isArray(result.failedCodes) ? result.failedCodes : [];
      if (codes.length === 0) {
        emitLog('[cmb-nav] 失败重试成功，所有产品均已抓取完成');
        break;
      }
    }
    if (codes.length > 0) {
      emitLog(`[cmb-nav] 失败重试结束，仍有产品抓取失败：${codes.join('、')}`);
    }
  } finally {
    retryLoopActive = false;
  }
}

/**
 * 视情况启动失败自动重试循环。
 *
 * 仅在 trigger 为 schedule/catchup、且本轮存在失败产品时启动；手动触发不自动重试。
 *
 * @param {{trigger:string, wantRetry:boolean, failedCodes:string[]}} params
 * @returns {void}
 */
function maybeScheduleRetry({ trigger, wantRetry, failedCodes }) {
  const isAutoTrigger = trigger === 'schedule' || trigger === 'catchup';
  if (!wantRetry || !isAutoTrigger || failedCodes.length === 0) return;
  runRetryLoop(failedCodes).catch((error) => {
    console.error('[cmb-nav] 失败重试循环异常：', error);
  });
}

/**
 * 执行一次同步（全局互斥）。
 *
 * @param {{codes?:string[], trigger?:string, retry?:boolean}} [options]
 *   - codes：指定产品代码；省略或为空表示全部 active=1 的产品
 *   - trigger：触发来源（manual/schedule/catchup/retry），默认 manual
 *   - retry：本轮失败后是否进入自动重试循环；默认按 trigger 推导（manual 为 false，其余为 true）
 * @returns {Promise<{started:boolean, reason?:string, result?:object}>}
 */
export async function runSync(options = {}) {
  if (running) {
    return { started: false, reason: '已有同步任务在运行' };
  }
  running = true;

  const explicit = Array.isArray(options.codes)
    ? options.codes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const codes = explicit.length ? explicit : listActiveCodes();
  const trigger = options.trigger || 'manual';
  const wantRetry = options.retry === undefined ? trigger !== 'manual' : Boolean(options.retry);

  const logId = startSyncLog(codes.length, trigger);
  let updated = 0;
  let failed = 0;
  let named = 0;
  const errors = [];
  const failedCodes = [];

  try {
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      // eslint-disable-next-line no-await-in-loop
      const outcome = await syncOne(code);
      if (outcome.ok) {
        if (outcome.saved > 0) updated += 1;
        if (outcome.named) named += 1;
      } else {
        failed += 1;
        failedCodes.push(code);
        errors.push(`${code}: ${outcome.error}`);
      }
      if (i < codes.length - 1) await sleep(config.cmb.requestGapMs);
    }

    const ok = failed === 0;
    const label = triggerLabel(trigger);
    const nameNote = named > 0 ? `，补全产品名 ${named} 个` : '';
    const message = errors.length
      ? `部分产品抓取失败（${label}）：${errors.slice(0, 5).join('；')}`
      : `抓取完成（${label}）：${updated}/${codes.length} 个产品有更新${nameNote}`;
    finishSyncLog(logId, { ok, total: codes.length, updated, failed, message });

    // 本轮有失败时，按需启动后台重试循环（不阻塞当前返回，也不占用互斥标志）。
    maybeScheduleRetry({ trigger, wantRetry, failedCodes });

    return { started: true, result: { total: codes.length, updated, failed, named, message, failedCodes } };
  } catch (error) {
    const message = error && error.message ? error.message : '同步任务异常';
    finishSyncLog(logId, { ok: false, total: codes.length, updated, failed, message });
    return {
      started: true,
      result: { total: codes.length, updated, failed, named, message, failedCodes },
    };
  } finally {
    running = false;
  }
}

/**
 * 从招行同步产品名称。
 *
 * 与净值抓取使用**相互独立**的互斥标志：两者都是「从招行取数据」，但一个写净值点、
 * 一个写产品名，互不冲突，因此不阻塞对方（各自防重入即可）。
 *
 * @param {{codes?:string[], overwrite?:boolean}} [options]
 *   - codes：指定产品代码；省略或为空表示全部产品（含已归档）
 *   - overwrite：默认 true，以招行名称为准覆盖本地；false 时只回填空名称
 * @returns {Promise<{started:boolean, reason?:string, result?:object}>}
 */
export async function syncProductNames(options = {}) {
  if (namesRunning) {
    return { started: false, reason: '已有产品名同步任务在运行' };
  }
  namesRunning = true;

  const overwrite = options.overwrite !== false;
  const explicit = Array.isArray(options.codes)
    ? options.codes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const targets = explicit.length
    ? explicit.map((code) => getProduct(code)).filter(Boolean)
    : listProducts();

  const updated = [];
  const unchanged = [];
  const missing = [];
  const errors = [];

  try {
    for (let i = 0; i < targets.length; i += 1) {
      const product = targets[i];
      try {
        // eslint-disable-next-line no-await-in-loop
        const { name } = await fetchProductName(product.code);
        const current = String(product.name || '').trim();
        if (!name) {
          missing.push(product.code);
        } else if (name === current || (!overwrite && current)) {
          // 名称一致，或非覆盖模式下本地已有名称 → 保持不动
          unchanged.push(product.code);
        } else {
          patchProduct(product.code, { name });
          updated.push(product.code);
        }
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        errors.push(`${product.code}: ${message}`);
      }
      if (i < targets.length - 1) await sleep(config.cmb.requestGapMs);
    }

    return {
      started: true,
      result: {
        total: targets.length,
        updated: updated.length,
        unchanged: unchanged.length,
        missing: missing.length,
        failed: errors.length,
        codes: updated,
        errors: errors.slice(0, 5),
      },
    };
  } finally {
    namesRunning = false;
  }
}

/**
 * 产品名同步是否正在运行。
 * @returns {boolean}
 */
export function isNameSyncRunning() {
  return namesRunning;
}

/**
 * 读取同步状态（供 API 使用）。
 * @returns {{running:boolean, lastRun:object|null}}
 */
export function getSyncStatus() {
  return { running, lastRun: getLastRun() };
}

/**
 * 启动定时器（启动时按需补抓一轮，随后指向下次定时时刻）。
 * @param {(message:string)=>void} [log]
 * @returns {void}
 */
export function startScheduler(log) {
  if (timer) return;
  if (typeof log === 'function') logger = log;

  // 启动补抓：若今日已过抓取时刻且今日尚无成功的自动抓取，则立即补抓（不阻塞启动）。
  const lastAutoRunStartedAt = getLastAutoRunStartedAt();
  if (shouldCatchUp(Date.now(), lastAutoRunStartedAt)) {
    emitLog('[cmb-nav] 检测到今日定时抓取尚未执行，正在补抓…');
    runSync({ trigger: 'catchup' }).catch((error) => {
      console.error('[cmb-nav] 启动补抓异常：', error);
    });
  }

  const scheduleNext = () => {
    const delay = msUntilNextRun();
    timer = setTimeout(async () => {
      try {
        await runSync({ trigger: 'schedule' });
      } catch (error) {
        console.error('[cmb-nav] 定时抓取异常：', error);
      }
      scheduleNext();
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    const minutes = Math.round(delay / 60000);
    emitLog(`[cmb-nav] 下次定时抓取将在约 ${minutes} 分钟后（每天 ${scheduleTimeText()} ${config.timezone}）`);
  };
  scheduleNext();
}

/**
 * 停止定时器与重试定时器。
 * @returns {void}
 */
export function stopScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
