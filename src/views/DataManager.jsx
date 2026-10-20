import React, { useMemo, useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Alert from '@mui/material/Alert';
import { usePortfolio } from '../hooks/usePortfolio.js';
import { PageHeader } from '../components/common.jsx';
import { downloadJson } from '../lib/storage.js';
import { DEFAULT_THRESHOLD } from '../lib/netvalue.js';
import { fmtDateTime } from '../lib/format.js';

/**
 * 数据管理视图：同步抓取 / 导出 / 导入 / 一键导入插件数据 / 清空 / 设置 / 退出登录。
 * @param {{notify: Function, onNavigate?: Function}} props
 */
export default function DataManager({ notify }) {
  const {
    products,
    settings,
    updateSettings,
    importStateObject,
    importSeed,
    clearAll,
    exportStateObject,
    seedSummary,
    stats,
    report,
    serverSync,
    syncAndWait,
    logout,
  } = usePortfolio();

  const fileRef = useRef(null);
  const [importMessage, setImportMessage] = useState(null);
  const [thresholdText, setThresholdText] = useState(() =>
    String(Number((settings.threshold * 100).toFixed(4))),
  );
  const [thresholdError, setThresholdError] = useState('');

  // 同步抓取状态
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const lastRun = serverSync?.lastRun || null;

  const totals = useMemo(
    () => ({
      products: products.length,
      active: products.filter((item) => item.active).length,
      navPoints: products.reduce((sum, item) => sum + item.history.length, 0),
      holdings: products.filter((item) => item.holding).length,
    }),
    [products],
  );

  const handleExport = () => {
    const payload = exportStateObject();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`cmb-nav-assistant-${stamp}.json`, payload);
    notify?.('已导出数据文件', 'success');
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products)) {
          throw new Error('文件结构不正确，缺少 products 数组');
        }
        const normalized = await importStateObject(parsed);
        setImportMessage({
          type: 'success',
          text: `导入成功：${normalized.products.length} 只产品 / ${normalized.products.reduce(
            (sum, item) => sum + item.history.length,
            0,
          )} 个净值点。`,
        });
        setThresholdText(String(Number((normalized.settings.threshold * 100).toFixed(4))));
        notify?.('数据导入成功', 'success');
      } catch (error) {
        setImportMessage({ type: 'error', text: `导入失败：${error.message}` });
        notify?.('数据导入失败', 'error');
      }
    };
    reader.onerror = () => {
      setImportMessage({ type: 'error', text: '读取文件失败，请重试' });
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleSeedImport = async () => {
    const summary = await importSeed();
    setImportMessage({
      type: summary.error ? 'error' : 'success',
      text: summary.error
        ? `导入失败：${summary.error}`
        : `已导入插件历史数据：${summary.products} 只产品 / ${summary.navPoints} 个净值点（${summary.active} 只监控中）。`,
    });
    notify?.(summary.error ? '导入失败' : '已导入插件历史数据', summary.error ? 'error' : 'success');
  };

  const handleClear = async () => {
    if (!window.confirm('确认清空全部数据？产品、净值历史、持仓与设置都会被删除，且不可恢复。')) {
      return;
    }
    if (!window.confirm('再次确认：服务器上的全部数据将被清除。是否继续？')) return;
    await clearAll();
    setImportMessage({ type: 'warning', text: '已清空服务器上的全部数据。' });
    notify?.('已清空全部数据', 'info');
  };

  const handleLogout = async () => {
    await logout();
  };

  /** 触发一次全量抓取并等待任务结束（轮询逻辑收敛在 usePortfolio.syncAndWait）。 */
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage('');
    try {
      const outcome = await syncAndWait();
      if (!outcome.started) {
        setSyncMessage(outcome.reason || '已有同步任务在运行');
        return;
      }
      const run = outcome.lastRun;
      if (run) {
        setSyncMessage(
          `${run.ok ? '同步成功' : '同步完成（部分失败）'}：更新 ${run.updated} 个产品，失败 ${run.failed} 个。${
            run.message || ''
          }`,
        );
      } else {
        setSyncMessage('同步已触发，请稍后查看结果。');
      }
      notify?.('净值同步完成', 'success');
    } catch (error) {
      setSyncMessage(error?.message || '同步失败');
      notify?.('净值同步失败', 'error');
    } finally {
      setSyncing(false);
    }
  };

  /** 阈值上限（%）。超过视为明显不合理输入，拒绝提交。 */
  const MAX_THRESHOLD_PERCENT = 1000;

  /** 把 input 的当前显示值还原为已保存阈值对应的百分比文本。 */
  const syncThresholdTextFromSettings = () => {
    setThresholdText(String(Number((settings.threshold * 100).toFixed(4))));
  };

  /**
   * 提交阈值。空串 / 纯空白 / 非法数值一律拒绝提交，并回显提示。
   * 注意 Number('') === 0，不能只靠 Number.isFinite 守卫。
   */
  const commitThreshold = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) {
      syncThresholdTextFromSettings();
      setThresholdError('请输入有效数字');
      return;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_THRESHOLD_PERCENT) {
      syncThresholdTextFromSettings();
      setThresholdError(`请输入 0 ~ ${MAX_THRESHOLD_PERCENT} 之间的数字（%）`);
      return;
    }
    setThresholdError('');
    updateSettings({ threshold: numeric / 100 });
  };

  /** 输入过程中只更新本地显示，不提交，避免中途值造成全表抖动。 */
  const handleThresholdChange = (event) => {
    setThresholdText(event.target.value);
    if (thresholdError) setThresholdError('');
  };

  /** 失焦时提交。 */
  const handleThresholdBlur = () => {
    commitThreshold(thresholdText);
  };

  /** 回车时提交。 */
  const handleThresholdKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitThreshold(thresholdText);
    }
  };

  const resetThreshold = () => {
    setThresholdText(String(Number((DEFAULT_THRESHOLD * 100).toFixed(4))));
    updateSettings({ threshold: DEFAULT_THRESHOLD });
    setThresholdError('');
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Data"
        title="数据管理"
        description={`全部数据保存在服务器 SQLite 数据库，多设备访问同一地址共享同一份数据。可导出备份、导入恢复、一键导入插件历史数据，或手动触发净值同步。`}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-sm font-black text-ink">数据迁移</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            导出为 JSON 文件备份；导入同一格式文件即可恢复到服务器（导出 → 导入 数据完全一致）。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              导出 JSON
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-brand-300 hover:text-brand-600"
            >
              导入 JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          <div className="mt-4 rounded-xl border border-line bg-slate-50/70 p-3">
            <p className="text-xs font-bold text-ink">一键导入插件历史数据</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              来源：{seedSummary.source || '插件导出'}（{fmtDateTime(
                String(seedSummary.extractedAt || '').slice(0, 19),
              )}
              ） 共 {seedSummary.productCount} 只产品 / {seedSummary.navPoints} 个净值点，
              其中 {seedSummary.activeCount} 只标记为监控中。导入时以代码合并，不会覆盖你自定义的名称与备注。
            </p>
            <button
              type="button"
              onClick={handleSeedImport}
              className="mt-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              导入插件历史数据
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-3">
            <p className="text-xs font-bold text-profit">危险操作</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              清空服务器上的全部数据（产品、净值、持仓、设置）。需要二次确认。
            </p>
            <button
              type="button"
              onClick={handleClear}
              className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-bold text-profit transition hover:bg-red-50"
            >
              清空全部数据
            </button>
          </div>

          {importMessage ? (
            <Alert severity={importMessage.type} sx={{ mt: 3 }}>
              {importMessage.text}
            </Alert>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="card p-4">
            <h2 className="text-sm font-black text-ink">净值自动同步</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              服务器每天 21:30（北京时间）自动抓取全部监控中产品的净值。也可在此手动立即抓取。
            </p>

            <div className="mt-3 rounded-xl border border-line bg-slate-50/70 p-3 text-xs text-muted">
              <p>
                上次同步：
                <strong className="text-ink">
                  {lastRun ? fmtDateTime(String(lastRun.startedAt || '').slice(0, 19)) : '—'}
                </strong>
              </p>
              <p className="mt-1">
                结果：
                <strong className="text-ink">
                  {lastRun
                    ? `${lastRun.ok ? '成功' : '部分失败'} · 更新 ${lastRun.updated} · 失败 ${lastRun.failed}`
                    : '尚未同步'}
                </strong>
              </p>
              {lastRun && lastRun.message ? (
                <p className="mt-1 break-words text-[11px] text-faint">{lastRun.message}</p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || serverSync?.running}
              className="mt-3 rounded-lg bg-brand-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing || serverSync?.running ? '抓取中…' : '立即抓取最新净值'}
            </button>

            {syncMessage ? (
              <Alert severity={syncMessage.includes('失败') ? 'warning' : 'success'} sx={{ mt: 3 }}>
                {syncMessage}
              </Alert>
            ) : null}
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-black text-ink">访问与账号</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              当前设备已登录。退出后需重新输入口令才能访问数据。
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-brand-300 hover:text-brand-600"
            >
              退出登录
            </button>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-black text-ink">阈值与提醒</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          年化收益率低于阈值时高亮警示；净值未更新到应披露日时给出提醒。
        </p>

        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label="告警阈值"
              value={thresholdText}
              onChange={handleThresholdChange}
              onBlur={handleThresholdBlur}
              onKeyDown={handleThresholdKeyDown}
              type="number"
              size="small"
              error={Boolean(thresholdError)}
              sx={{ width: 180 }}
              InputProps={{ endAdornment: <span className="text-sm text-muted">%</span> }}
              inputProps={{ step: '0.1', min: '0' }}
              helperText={thresholdError || '默认 3%，失焦或回车生效'}
            />
            <button
              type="button"
              onClick={resetThreshold}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-brand-300 hover:text-brand-600"
            >
              恢复默认
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
            <div>
              <p className="text-sm font-bold text-ink">净值未更新提醒</p>
              <p className="text-[11px] text-muted">最新净值日期早于应披露日时提醒</p>
            </div>
            <Switch
              checked={settings.staleReminder}
              onChange={(event) => updateSettings({ staleReminder: event.target.checked })}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
            <div>
              <p className="text-sm font-bold text-ink">低于阈值警示</p>
              <p className="text-[11px] text-muted">年化收益率低于阈值时标红</p>
            </div>
            <Switch
              checked={settings.alertBelowThreshold}
              onChange={(event) =>
                updateSettings({ alertBelowThreshold: event.target.checked })
              }
            />
          </div>

          <div className="rounded-xl border border-line bg-slate-50/70 p-3 text-xs text-muted">
            <p>
              应披露日（上一工作日，排除周末与内置节假日）：
              <strong className="text-ink">{report.expectedDisclosureDate || '—'}</strong>
            </p>
            <p className="mt-1">
              当前阈值：<strong className="text-ink">{(settings.threshold * 100).toFixed(2)}%</strong>
              （低于此值的产品会计入「低于阈值」）
            </p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-black text-ink">服务器数据概览</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11px] text-muted">产品总数</p>
            <p className="mt-1 text-xl font-black text-ink">{totals.products}</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11px] text-muted">监控中</p>
            <p className="mt-1 text-xl font-black text-ink">{totals.active}</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11px] text-muted">净值点总数</p>
            <p className="mt-1 text-xl font-black text-ink">{totals.navPoints}</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11px] text-muted">已录入持仓</p>
            <p className="mt-1 text-xl font-black text-ink">{totals.holdings}</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          数据存储于服务器 SQLite 数据库（WAL 模式）·
          低于阈值 {stats.underThreshold} 只 · 未更新 {stats.stale} 只。
          建议定期导出 JSON 备份；服务器数据库文件位于 DATA_DIR/cmb.db。
        </p>
      </section>
    </div>
  );
}
