/**
 * 组合数据状态管理 Hook + Context（后端版）。
 *
 * 数据源从 localStorage 切换为服务器 SQLite（通过 /api/state 读取）。
 * - 对外暴露的接口形状尽量与旧版保持一致（products / settings / addProducts /
 *   saveProduct / mergeNavPoints / ...），各 view 组件几乎无需改动。
 * - 每个写操作：先调 API，成功后用服务端返回的数据刷新本地 state。
 * - 年化算法（src/lib/netvalue.js）与工作日表（src/lib/holidays.js）**完全未改动**，
 *   这里只负责「数据从哪来」。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  buildReport,
  DEFAULT_THRESHOLD,
  evaluateProduct,
  summarizeReport,
} from '../lib/netvalue.js';
import {
  createDefaultState,
  normalizeHistory,
  normalizeState,
} from '../lib/storage.js';
import { AuthError, api } from '../lib/api.js';
import { SEED_RAW, getSeedSummary } from '../data/seed.js';

const PortfolioContext = createContext(null);

/**
 * 把服务端 /api/state 的响应映射为本地 state（结构与旧版一致）。
 * @param {object} data
 * @returns {object}
 */
function mapServerState(data) {
  const products = Array.isArray(data?.products) ? data.products : [];
  const now = new Date().toISOString();
  return {
    version: 1,
    products: products.map((item) => ({
      code: item.code,
      name: item.name || '',
      note: item.note || '',
      active: item.active !== false,
      holding: item.holding || null,
      history: Array.isArray(item.history) ? item.history : [],
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    })),
    settings: {
      threshold:
        typeof data?.settings?.threshold === 'number' ? data.settings.threshold : DEFAULT_THRESHOLD,
      staleReminder: data?.settings?.staleReminder !== false,
      alertBelowThreshold: data?.settings?.alertBelowThreshold !== false,
      scheduleEnabled: data?.settings?.scheduleEnabled !== false,
      scheduleHour: Number.isInteger(data?.settings?.scheduleHour)
        ? data.settings.scheduleHour
        : 9,
      scheduleMinute: Number.isInteger(data?.settings?.scheduleMinute)
        ? data.settings.scheduleMinute
        : 0,
    },
  };
}

/**
 * PortfolioProvider：为子树提供组合数据与操作。
 * @param {{children: React.ReactNode}} props
 */
export function PortfolioProvider({ children }) {
  const [state, setState] = useState(() => createDefaultState());
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const [serverSync, setServerSync] = useState({ running: false, lastRun: null });
  /** 服务端定时抓取快照（是否启用 / 时刻 / 下次执行时间）。 */
  const [serverSchedule, setServerSchedule] = useState(null);

  const seedSummary = useMemo(() => getSeedSummary(), []);

  /** 统一处理写操作抛出的认证错误。 */
  const handleActionError = useCallback((err) => {
    if (err instanceof AuthError || (err && err.authError)) {
      setAuthenticated(false);
      return;
    }
    setError(err && err.message ? err.message : '操作失败');
  }, []);

  /** 从服务器刷新全量状态。 */
  const refresh = useCallback(async () => {
    const data = await api.getState();
    setState(mapServerState(data));
    setServerSync({
      running: Boolean(data?.sync?.running),
      lastRun: data?.sync?.lastRun || null,
    });
    setServerSchedule(data?.schedule || null);
    return data;
  }, []);

  // 启动引导：先确认登录态，已登录则拉取数据。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        if (me && me.authenticated) {
          setAuthenticated(true);
          await refresh();
        } else {
          setAuthenticated(false);
        }
      } catch (err) {
        if (!cancelled) setError(err && err.message ? err.message : '初始化失败');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /** 登录。口令错误时抛出，供登录门显示提示。 */
  const login = useCallback(
    async (password) => {
      await api.login(password);
      setAuthenticated(true);
      setError('');
      await refresh();
    },
    [refresh],
  );

  /** 退出登录。 */
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* 忽略退出失败，本地一律登出 */
    }
    setAuthenticated(false);
    setState(createDefaultState());
    setServerSync({ running: false, lastRun: null });
    setServerSchedule(null);
  }, []);

  /** 批量新增产品。 */
  const addProducts = useCallback(
    async (codes) => {
      try {
        const result = await api.addProducts(codes);
        await refresh();
        return { added: result.added || [], skipped: result.skipped || [] };
      } catch (err) {
        handleActionError(err);
        return { added: [], skipped: [], error: err && err.message ? err.message : '新增失败' };
      }
    },
    [refresh, handleActionError],
  );

  /**
   * 新增或编辑产品基础信息。
   * 编辑且改了代码时，按「新建 → 迁移净值/持仓 → 删除旧代码」实现重命名。
   */
  const saveProduct = useCallback(
    async (payload, editingCode = null) => {
      const code = String(payload?.code || editingCode || '').trim().toUpperCase();
      if (!code) return { ok: false, error: '产品代码不能为空' };
      const name = String(payload?.name || '').trim();
      const note = String(payload?.note || '').trim();
      const editCode = editingCode ? String(editingCode).trim().toUpperCase() : null;

      const duplicate = state.products.some((item) => item.code === code && item.code !== editCode);
      if (duplicate) return { ok: false, error: `${code} 已在列表中` };

      try {
        if (editCode && editCode !== code) {
          const old = state.products.find((item) => item.code === editCode);
          await api.addProducts([code]);
          await api.patchProduct(code, { name, note, active: old ? old.active : true });
          if (old && old.history.length) await api.saveNav(code, old.history, 'manual');
          if (old && old.holding) await api.saveHolding(code, old.holding);
          await api.deleteProduct(editCode);
        } else if (editCode) {
          await api.patchProduct(editCode, { name, note });
        } else {
          const result = await api.addProducts([code]);
          if (!result.added.includes(code)) return { ok: false, error: `${code} 已在列表中` };
          await api.patchProduct(code, { name, note });
        }
        await refresh();
        return { ok: true, error: '' };
      } catch (err) {
        handleActionError(err);
        return { ok: false, error: err && err.message ? err.message : '保存失败' };
      }
    },
    [state.products, refresh, handleActionError],
  );

  /** 更新产品任意字段。 */
  const updateProduct = useCallback(
    async (code, patch) => {
      try {
        await api.patchProduct(code, patch);
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
    },
    [refresh, handleActionError],
  );

  /** 批量删除产品。 */
  const deleteProducts = useCallback(
    async (codes) => {
      try {
        for (const code of codes) await api.deleteProduct(code);
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
    },
    [refresh, handleActionError],
  );

  /** 批量设置监控状态（归档 / 恢复）。 */
  const setActive = useCallback(
    async (codes, active) => {
      try {
        for (const code of codes) await api.patchProduct(code, { active });
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
    },
    [refresh, handleActionError],
  );

  /** 更新持仓。holding 为空表示清除。 */
  const setHolding = useCallback(
    async (code, holding) => {
      try {
        await api.saveHolding(code, holding || {});
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
    },
    [refresh, handleActionError],
  );

  /** 录入 / 合并净值点（手动来源）。 */
  const mergeNavPoints = useCallback(
    async (code, points) => {
      const target = state.products.find((item) => item.code === code);
      const previousCount = target ? target.history.length : 0;
      const existing = new Set((target?.history || []).map((point) => point.date));
      const normalized = normalizeHistory(points);
      let added = 0;
      let updated = 0;
      for (const point of normalized) {
        if (existing.has(point.date)) updated += 1;
        else {
          existing.add(point.date);
          added += 1;
        }
      }
      try {
        const result = await api.saveNav(code, normalized, 'manual');
        await refresh();
        return {
          added,
          updated,
          saved: result.saved,
          total: previousCount + added,
        };
      } catch (err) {
        handleActionError(err);
        return {
          added: 0,
          updated: 0,
          saved: 0,
          total: previousCount,
          error: err && err.message ? err.message : '保存失败',
        };
      }
    },
    [state.products, refresh, handleActionError],
  );

  /** 删除单个净值点。 */
  const removeNavPoint = useCallback(
    async (code, date) => {
      try {
        await api.deleteNav(code, [date]);
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
    },
    [refresh, handleActionError],
  );

  /** 清空某产品净值历史。 */
  const clearNavHistory = useCallback(
    async (code) => {
      try {
        await api.deleteNav(code);
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
    },
    [refresh, handleActionError],
  );

  /** 更新设置（使用服务端返回的完整 settings）。 */
  const updateSettings = useCallback(
    async (patch) => {
      try {
        const settings = await api.saveSettings(patch);
        setState((prev) => ({ ...prev, settings }));
        // 定时相关改动会改变「下次执行时间」，重新拉一次调度快照。
        const touchesSchedule =
          patch.scheduleEnabled !== undefined ||
          patch.scheduleHour !== undefined ||
          patch.scheduleMinute !== undefined;
        if (touchesSchedule) await refresh();
        return settings;
      } catch (err) {
        handleActionError(err);
        return null;
      }
    },
    [handleActionError, refresh],
  );

  /** 用外部对象整体替换状态（用于 JSON 导入），逐个推送到服务端。 */
  const importStateObject = useCallback(
    async (raw) => {
      const normalized = normalizeState(raw);
      try {
        for (const product of normalized.products) {
          await api.addProducts([product.code]);
          await api.patchProduct(product.code, {
            name: product.name,
            note: product.note,
            active: product.active,
          });
          if (product.history.length) await api.saveNav(product.code, product.history, 'manual');
          if (product.holding) await api.saveHolding(product.code, product.holding);
        }
        await api.saveSettings(normalized.settings);
        await refresh();
      } catch (err) {
        handleActionError(err);
      }
      return normalized;
    },
    [refresh, handleActionError],
  );

  /** 一键导入插件历史数据（把打包进前端的 seed-data.json 推送给后端）。 */
  const importSeed = useCallback(async () => {
    try {
      const summary = await api.importSeed(SEED_RAW);
      await refresh();
      return {
        products: summary.products,
        navPoints: summary.points,
        active: summary.active,
        added: summary.created,
      };
    } catch (err) {
      handleActionError(err);
      return { products: 0, navPoints: 0, active: 0, error: err && err.message ? err.message : '导入失败' };
    }
  }, [refresh, handleActionError]);

  /** 清空全部数据（删除全部产品 + 重置设置）。 */
  const clearAll = useCallback(async () => {
    try {
      const data = await api.getState();
      for (const product of data.products) await api.deleteProduct(product.code);
      await api.saveSettings({
        threshold: DEFAULT_THRESHOLD,
        staleReminder: true,
        alertBelowThreshold: true,
      });
      await refresh();
    } catch (err) {
      handleActionError(err);
    }
  }, [refresh, handleActionError]);

  /** 导出当前状态（深拷贝）。 */
  const exportStateObject = useCallback(() => JSON.parse(JSON.stringify(state)), [state]);

  /** 触发一次同步抓取（不等待结果）。 */
  const sync = useCallback(async (codes) => api.sync(codes), []);

  /** 拉取同步日志。 */
  const fetchSyncLog = useCallback(async () => api.syncLog(), []);

  /**
   * 从招行同步产品名称，完成后刷新状态。
   *
   * @param {string[]} [codes] 指定产品代码；省略表示全部产品（含已归档）
   * @param {boolean} [overwrite] 是否覆盖已有名称（默认 true）
   * @returns {Promise<object>} `{started, updated, unchanged, missing, failed, ...}`；
   *   失败时返回 `{error}`，调用方按需展示。
   */
  const syncNames = useCallback(
    async (codes, overwrite = true) => {
      try {
        return await api.syncNames(codes, overwrite);
      } catch (err) {
        handleActionError(err);
        return { error: err && err.message ? err.message : '同步产品名失败' };
      } finally {
        try {
          await refresh();
        } catch {
          /* 刷新失败不影响同步结果本身，交由下一次轮询纠正 */
        }
      }
    },
    [refresh, handleActionError],
  );

  /**
   * 触发抓取并等待任务结束（内部轮询同步日志，最长约 8 分钟）。
   *
   * 抓取是后端唯一的全局互斥任务，因此调用方在拿到 `started:false` 时
   * 应当把 reason 原样展示给用户，而不是报错。
   *
   * @param {string[]} [codes] 指定产品代码；省略则抓取全部监控中产品。
   * @returns {Promise<{started:boolean, reason?:string, lastRun?:object|null}>}
   */
  const syncAndWait = useCallback(
    async (codes) => {
      const started = await api.sync(codes);
      if (!started || !started.started) {
        return { started: false, reason: (started && started.reason) || '已有抓取任务在运行' };
      }
      let log = null;
      for (let i = 0; i < 400; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        log = await api.syncLog();
        if (!log || !log.running) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await refresh();
      return { started: true, lastRun: (log && log.lastRun) || null };
    },
    [refresh],
  );

  // 派生：监控报告（仅 active 产品）。
  const report = useMemo(
    () => buildReport(state.products, state.settings),
    [state.products, state.settings],
  );

  // 派生：报告统计。
  const stats = useMemo(() => summarizeReport(report), [report]);

  // 派生：全部产品的评估结果（含归档）。
  const evaluations = useMemo(
    () =>
      state.products.map((product) => ({
        product,
        result: evaluateProduct(
          product,
          report.expectedDisclosureDate,
          state.settings.threshold,
        ),
      })),
    [state.products, report.expectedDisclosureDate, state.settings.threshold],
  );

  const value = useMemo(
    () => ({
      state,
      products: state.products,
      settings: state.settings,
      report,
      stats,
      evaluations,
      seedSummary,
      // 运行态
      ready,
      loading: !ready,
      error,
      authenticated,
      serverSync,
      serverSchedule,
      // auth
      login,
      logout,
      refresh,
      // actions
      addProducts,
      saveProduct,
      updateProduct,
      deleteProducts,
      setActive,
      setHolding,
      mergeNavPoints,
      removeNavPoint,
      clearNavHistory,
      updateSettings,
      importStateObject,
      importSeed,
      clearAll,
      exportStateObject,
      sync,
      syncAndWait,
      fetchSyncLog,
      syncNames,
    }),
    [
      state,
      report,
      stats,
      evaluations,
      seedSummary,
      ready,
      error,
      authenticated,
      serverSync,
      serverSchedule,
      login,
      logout,
      refresh,
      addProducts,
      saveProduct,
      updateProduct,
      deleteProducts,
      setActive,
      setHolding,
      mergeNavPoints,
      removeNavPoint,
      clearNavHistory,
      updateSettings,
      importStateObject,
      importSeed,
      clearAll,
      exportStateObject,
      sync,
      syncAndWait,
      fetchSyncLog,
      syncNames,
    ],
  );

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

/**
 * 读取组合上下文；必须在 PortfolioProvider 内使用。
 * @returns {any}
 */
export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio 必须在 PortfolioProvider 内部使用');
  }
  return context;
}
