import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../hooks/usePortfolio.js';
import ProductTable from '../components/ProductTable.jsx';
import ProductFormDialog from '../components/ProductFormDialog.jsx';
import NavEntryDialog from '../components/NavEntryDialog.jsx';
import BulkImportDialog from '../components/BulkImportDialog.jsx';
import HoldingDialog from '../components/HoldingDialog.jsx';
import { EmptyState, PageHeader } from '../components/common.jsx';
import { fmtDateTime } from '../lib/format.js';
import Checkbox from '@mui/material/Checkbox';

const STATUS_FILTERS = [
  { key: 'active', label: '监控中' },
  { key: 'archived', label: '已归档' },
  { key: 'all', label: '全部' },
];

/**
 * 净值管理视图：筛选、搜索、批量操作、净值 / 持仓录入。
 * @param {{notify: Function, onNavigate: Function}} props
 */
export default function NavManager({ notify }) {
  const {
    products,
    evaluations,
    settings,
    serverSync,
    addProducts,
    saveProduct,
    deleteProducts,
    setActive,
    setHolding,
    mergeNavPoints,
    syncAndWait,
    syncNames,
  } = usePortfolio();

  const [statusFilter, setStatusFilter] = useState('active');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  // 抓取状态：syncing 为整页互斥（后端同一时刻只允许一个抓取任务），
  // syncingCodes 用于把「抓取中…」精确标到触发的那几行上。
  const [syncing, setSyncing] = useState(false);
  const [syncingCodes, setSyncingCodes] = useState(() => new Set());
  // 产品名同步（与净值抓取互不阻塞，各自独立）。
  const [nameSyncing, setNameSyncing] = useState(false);

  const [productDialog, setProductDialog] = useState({ open: false, mode: 'create', product: null });
  const [navDialog, setNavDialog] = useState({ open: false, product: null });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [holdingDialog, setHoldingDialog] = useState({ open: false, product: null });

  const rows = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    return evaluations
      .filter(({ product }) => {
        if (statusFilter === 'active' && !product.active) return false;
        if (statusFilter === 'archived' && product.active) return false;
        return true;
      })
      .filter(({ product }) => {
        if (!trimmed) return true;
        return (
          product.code.toLowerCase().includes(trimmed) ||
          (product.name || '').toLowerCase().includes(trimmed)
        );
      });
  }, [evaluations, statusFilter, keyword]);

  const visibleCodes = rows.map(({ product }) => product.code);
  const allSelected = visibleCodes.length > 0 && visibleCodes.every((code) => selected.has(code));
  const someSelected = visibleCodes.some((code) => selected.has(code));

  const toggleOne = (code) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleAll = (checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const code of visibleCodes) {
        if (checked) next.add(code);
        else next.delete(code);
      }
      return next;
    });
  };

  const selectedCodes = useMemo(() => Array.from(selected), [selected]);

  const handleDelete = (code) => {
    if (!window.confirm(`确认删除 ${code}？该产品的净值历史与持仓将一并删除。`)) return;
    deleteProducts([code]);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
    notify?.(`已删除 ${code}`, 'info');
  };

  const handleBulkDelete = () => {
    if (!selectedCodes.length) return;
    if (!window.confirm(`确认删除选中的 ${selectedCodes.length} 只产品？此操作不可撤销。`)) return;
    deleteProducts(selectedCodes);
    notify?.(`已删除 ${selectedCodes.length} 只产品`, 'info');
    setSelected(new Set());
  };

  const handleBulkActive = (active) => {
    if (!selectedCodes.length) return;
    setActive(selectedCodes, active);
    notify?.(`已${active ? '恢复' : '归档'} ${selectedCodes.length} 只产品`, 'success');
    setSelected(new Set());
  };

  const handleToggleActive = (product) => {
    setActive([product.code], !product.active);
    notify?.(`${product.code} 已${product.active ? '归档' : '恢复'}监控`, 'success');
  };

  const handleNavSubmit = (code, points) => mergeNavPoints(code, points);

  const handleNavClose = (summary) => {
    setNavDialog({ open: false, product: null });
    if (summary && summary.saved) {
      notify?.(
        `已保存 ${summary.saved} 条净值（新增 ${summary.added ?? 0}，覆盖 ${summary.updated ?? 0}）${
          summary.errorLines ? `，忽略 ${summary.errorLines} 行错误` : ''
        }`,
        summary.errorLines ? 'warning' : 'success',
      );
    } else if (summary && summary.errorLines) {
      notify?.(`没有可保存的有效行，${summary.errorLines} 行解析失败`, 'warning');
    }
  };

  /**
   * 从招行同步产品名称。
   *
   * @param {string[]|null} codes 指定产品代码；null/空表示全部产品（含已归档）
   * @param {boolean} overwrite true=以招行名称为准覆盖本地；false=只回填空名称
   * @param {boolean} silent 静默模式（用于批量录入后的自动补名，只报关键结果）
   */
  const runNameSync = async (codes, overwrite, silent = false) => {
    if (nameSyncing) return null;
    setNameSyncing(true);
    try {
      const result = await syncNames(codes || undefined, overwrite);
      if (!result || result.error) {
        if (!silent) notify?.(`同步产品名失败：${result?.error || '未知错误'}`, 'error');
        return result;
      }
      if (result.started === false) {
        if (!silent) notify?.(result.reason || '已有产品名同步任务在运行', 'warning');
        return result;
      }
      if (silent) {
        if (result.updated > 0) notify?.(`已自动补全 ${result.updated} 个产品名`, 'success');
        if (result.failed > 0) {
          notify?.(`${result.failed} 个产品名补全失败，可稍后点「同步产品名」重试`, 'warning');
        }
        return result;
      }
      const parts = [`更新 ${result.updated} 个`];
      if (result.unchanged) parts.push(`未变 ${result.unchanged} 个`);
      if (result.missing) parts.push(`招行未返回名称 ${result.missing} 个`);
      if (result.failed) parts.push(`失败 ${result.failed} 个`);
      notify?.(`产品名同步完成：${parts.join('，')}`, result.failed ? 'warning' : 'success');
      return result;
    } catch (error) {
      if (!silent) notify?.(`同步产品名失败：${error?.message || '未知错误'}`, 'error');
      return null;
    } finally {
      setNameSyncing(false);
    }
  };

  /** 页头「同步产品名」按钮：全量、以招行为准（会覆盖本地名称，故先确认）。 */
  const handleSyncNamesClick = () => {
    if (nameSyncing) return;
    const blank = products.filter((item) => !String(item.name || '').trim()).length;
    const hint = blank
      ? `当前有 ${blank} 只产品没有名称。`
      : '';
    const confirmed = window.confirm(
      `${hint}将从招行同步全部 ${products.length} 只产品的名称，本地已有名称（含手动修改过的）会被覆盖。确认继续？`,
    );
    if (!confirmed) return;
    runNameSync(null, true, false);
  };

  const handleBulkSubmit = async (codes) => {
    const result = await addProducts(codes);
    // 新增后立刻从招行补全名称（只填空名，绝不覆盖已有名称）。
    if (result && Array.isArray(result.added) && result.added.length) {
      await runNameSync(result.added, false, true);
    }
    return result;
  };

  const handleSaveProduct = async (payload) => {
    const editingCode = productDialog.mode === 'edit' ? productDialog.product?.code : null;
    const result = await saveProduct(payload, editingCode);
    if (result.ok) {
      notify?.(editingCode ? '产品已更新' : '产品已新增', 'success');
      // 单个新增且用户没填名称时，同样顺手从招行补全（只填空名）。
      const typedName = String(payload?.name || '').trim();
      const newCode = String(payload?.code || '').trim().toUpperCase();
      if (!editingCode && !typedName && newCode) {
        await runNameSync([newCode], false, true);
      }
    }
    return result;
  };

  /** 是否有抓取任务在跑（本地刚触发，或服务端已有任务）。 */
  const syncBusy = syncing || Boolean(serverSync?.running);
  const lastRun = serverSync?.lastRun || null;

  /** 批量标记 / 解除某些行的「抓取中」状态。 */
  const markSyncing = (codes, on) => {
    setSyncingCodes((prev) => {
      const next = new Set(prev);
      for (const code of codes) {
        if (on) next.add(code);
        else next.delete(code);
      }
      return next;
    });
  };

  /**
   * 触抓取并等待结果。
   * @param {string[]|undefined} codes 指定产品；undefined/空表示全部监控中产品。
   * @param {string} label 通知文案前缀。
   */
  const runSync = async (codes, label) => {
    if (syncBusy) return;
    const scoped = Array.isArray(codes) && codes.length ? codes : null;
    setSyncing(true);
    if (scoped) markSyncing(scoped, true);
    try {
      const outcome = await syncAndWait(scoped || undefined);
      if (!outcome.started) {
        notify?.(outcome.reason || '已有抓取任务在运行', 'warning');
        return;
      }
      const run = outcome.lastRun;
      if (!run) {
        notify?.(`${label}已提交，稍后刷新查看结果`, 'info');
        return;
      }
      const detail = `更新 ${run.updated} 个、失败 ${run.failed} 个`;
      const failed = Number(run.failed) > 0;
      notify?.(`${label}${failed ? '部分失败' : '完成'}：${detail}`, failed ? 'warning' : 'success');
    } catch (error) {
      notify?.(`${label}失败：${error?.message || '未知错误'}`, 'error');
    } finally {
      if (scoped) markSyncing(scoped, false);
      setSyncing(false);
    }
  };

  const handleHoldingSubmit = (code, holding) => {
    setHolding(code, holding);
    notify?.(holding ? `${code} 持仓已保存` : `${code} 持仓已清除`, 'success');
  };

  const holdingProduct = holdingDialog.product
    ? products.find((item) => item.code === holdingDialog.product.code)
    : null;
  const holdingLatest = holdingProduct?.history?.length
    ? holdingProduct.history[holdingProduct.history.length - 1].nav
    : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Net Value"
        title="净值管理"
        description="维护产品清单与净值历史。可直接在列表抓取最新净值；产品名可从招行同步（新增产品会自动补全）。同一日期重复录入将覆盖旧值，历史始终按日期升序保存。"
        actions={
          <>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-brand-300 hover:text-brand-600"
            >
              批量录入代码
            </button>
            <button
              type="button"
              onClick={() =>
                setProductDialog({ open: true, mode: 'create', product: null })
              }
              className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              新增产品
            </button>
            <button
              type="button"
              onClick={handleSyncNamesClick}
              disabled={nameSyncing}
              title="从招行同步产品名称（含已归档；以招行返回为准，覆盖本地名称）"
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {nameSyncing ? '同步中…' : '同步产品名'}
            </button>
            <button
              type="button"
              onClick={() => runSync(null, '抓取净值')}
              disabled={syncBusy}
              title="抓取全部「监控中」产品的最新净值，范围与每日定时抓取一致（抓取时间可在「数据管理」页修改）"
              className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-bold text-brand-600 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncBusy ? '抓取中…' : '抓取最新净值'}
            </button>
          </>
        }
      />

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                statusFilter === item.key
                  ? 'bg-brand-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索产品代码或名称"
          className="min-w-[200px] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm outline-none transition focus:border-brand-400"
        />

        {selectedCodes.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted">
              已选 {selectedCodes.length} 项
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={syncBusy}
              onClick={() => runSync(selectedCodes, `抓取选中 ${selectedCodes.length} 只`)}
            >
              {syncing ? '抓取中…' : '抓取选中'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => handleBulkActive(true)}
            >
              恢复监控
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => handleBulkActive(false)}
            >
              归档
            </button>
            <button type="button" className="btn-ghost-danger" onClick={handleBulkDelete}>
              批量删除
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-faint">共 {rows.length} 只产品</span>
            <span className="hidden text-[11px] text-faint sm:inline">
              {lastRun
                ? `上次抓取 ${fmtDateTime(String(lastRun.startedAt || '').slice(0, 19))}`
                : '尚未抓取过净值'}
            </span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="没有符合条件的产品"
          description="尝试切换筛选条件、修改搜索关键字，或先批量录入产品代码。"
          action={
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              批量录入代码
            </button>
          }
        />
      ) : (
        <>
          <ProductTable
            rows={rows}
            selected={selected}
            onToggle={toggleOne}
            onToggleAll={toggleAll}
            allSelected={allSelected}
            someSelected={someSelected}
            onEditProduct={(product) =>
              setProductDialog({ open: true, mode: 'edit', product })
            }
            onEditNav={(product) => setNavDialog({ open: true, product })}
            onEditHolding={(product) => setHoldingDialog({ open: true, product })}
            onToggleActive={handleToggleActive}
            onDelete={handleDelete}
            onSyncProduct={(product) => runSync([product.code], `抓取 ${product.code}`)}
            syncingCodes={syncingCodes}
            syncBusy={syncBusy}
          />
          <p className="flex items-center gap-2 text-[11px] text-faint">
            <Checkbox size="small" checked disabled sx={{ p: 0 }} />
            勾选产品后可执行批量归档 / 恢复 / 删除。
          </p>
        </>
      )}

      <ProductFormDialog
        open={productDialog.open}
        mode={productDialog.mode}
        initial={productDialog.product}
        onSubmit={handleSaveProduct}
        onClose={() => setProductDialog({ open: false, mode: 'create', product: null })}
      />

      <NavEntryDialog
        open={navDialog.open}
        product={navDialog.product}
        onSubmit={handleNavSubmit}
        onClose={handleNavClose}
      />

      <BulkImportDialog
        open={bulkOpen}
        existingCodes={products.map((item) => item.code)}
        onSubmit={handleBulkSubmit}
        onClose={() => setBulkOpen(false)}
      />

      <HoldingDialog
        open={holdingDialog.open}
        product={holdingProduct}
        latestNav={holdingLatest}
        onSubmit={handleHoldingSubmit}
        onClose={() => setHoldingDialog({ open: false, product: null })}
      />
    </div>
  );
}
