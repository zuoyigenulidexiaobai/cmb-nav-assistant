import React, { useMemo, useState } from 'react';
import Checkbox from '@mui/material/Checkbox';
import { usePortfolio } from '../hooks/usePortfolio.js';
import HoldingDialog from '../components/HoldingDialog.jsx';
import { EmptyState, PageHeader } from '../components/common.jsx';
import { annualized, daysBetween } from '../lib/netvalue.js';
import { fmtMoney, fmtNav, fmtPercent } from '../lib/format.js';

/**
 * 计算单只产品的持仓指标。
 * @param {object} product
 * @returns {object|null}
 */
function computeHolding(product) {
  const holding = product.holding;
  const history = product.history || [];
  if (!holding || history.length === 0) return null;

  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const { shares, costNav } = holding;
  const marketValue = shares * latest.nav;
  const cost = shares * costNav;
  const profit = marketValue - cost;
  const profitRate = cost > 0 ? profit / cost : NaN;
  // 以净值历史首日至最新日期作为持有期代理（模型未记录申购日期）。
  const holdingDays = daysBetween(latest.date, history[0].date);
  const holdingAnnualized = annualized(latest.nav, costNav, holdingDays);
  const dayProfit = previous ? (latest.nav - previous.nav) * shares : NaN;
  const dayRate = previous && previous.nav > 0 ? latest.nav / previous.nav - 1 : NaN;

  return {
    shares,
    costNav,
    latestNav: latest.nav,
    latestDate: latest.date,
    prevNav: previous ? previous.nav : null,
    marketValue,
    cost,
    profit,
    profitRate,
    holdingDays,
    holdingAnnualized,
    dayProfit,
    dayRate,
  };
}

/**
 * 金额/收益着色：盈利红、亏损绿（国内习惯）。
 * @param {number} value
 * @returns {string}
 */
function moneyTone(value) {
  if (!Number.isFinite(value) || value === 0) return 'text-muted';
  return value > 0 ? 'text-profit' : 'text-loss';
}

/**
 * 持仓收益视图。
 * @param {{notify: Function, onNavigate: Function}} props
 */
export default function HoldingsView({ notify, onNavigate }) {
  const { products, setHolding } = usePortfolio();
  const [onlyWithHolding, setOnlyWithHolding] = useState(false);
  const [dialog, setDialog] = useState({ open: false, product: null });

  const rows = useMemo(() => {
    return products
      .filter((item) => item.active || item.holding)
      .map((product) => ({ product, stats: computeHolding(product) }));
  }, [products]);

  const visibleRows = onlyWithHolding ? rows.filter((row) => row.stats) : rows;

  const summary = useMemo(() => {
    let marketValue = 0;
    let cost = 0;
    let hasAny = false;
    for (const row of rows) {
      if (!row.stats) continue;
      hasAny = true;
      marketValue += row.stats.marketValue;
      cost += row.stats.cost;
    }
    const profit = marketValue - cost;
    return {
      marketValue,
      cost,
      profit,
      profitRate: cost > 0 ? profit / cost : NaN,
      count: rows.filter((row) => row.stats).length,
      hasAny,
    };
  }, [rows]);

  const dialogProduct = dialog.product
    ? products.find((item) => item.code === dialog.product.code)
    : null;
  const dialogLatest = dialogProduct?.history?.length
    ? dialogProduct.history[dialogProduct.history.length - 1].nav
    : null;

  const handleHoldingSubmit = (code, holding) => {
    setHolding(code, holding);
    notify?.(holding ? `${code} 持仓已保存` : `${code} 持仓已清除`, 'success');
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Holdings"
        title="持仓收益"
        description="录入持有份额与成本净值，自动计算市值、持有收益、持有期年化与当日收益估算。"
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">持仓总市值</p>
          <p className="mt-2 text-2xl font-black text-ink">
            {summary.hasAny ? fmtMoney(summary.marketValue) : '—'}
          </p>
          <p className="mt-1 text-[11px] text-faint">已录入 {summary.count} 只产品</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">持仓总成本</p>
          <p className="mt-2 text-2xl font-black text-ink">
            {summary.hasAny ? fmtMoney(summary.cost) : '—'}
          </p>
          <p className="mt-1 text-[11px] text-faint">份额 × 成本净值</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">持有总收益</p>
          <p className={`mt-2 text-2xl font-black ${moneyTone(summary.profit)}`}>
            {summary.hasAny ? fmtMoney(summary.profit) : '—'}
          </p>
          <p className="mt-1 text-[11px] text-faint">市值 − 成本</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">持有总收益率</p>
          <p className={`mt-2 text-2xl font-black ${moneyTone(summary.profitRate)}`}>
            {summary.hasAny ? fmtPercent(summary.profitRate) : '—'}
          </p>
          <p className="mt-1 text-[11px] text-faint">收益 ÷ 成本</p>
        </div>
      </section>

      {products.length === 0 ? (
        <EmptyState
          title="暂无产品"
          description="请先在「净值管理」或「数据管理」中添加产品，再录入持仓。"
          action={
            <button
              type="button"
              onClick={() => onNavigate?.('data')}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              前往数据管理
            </button>
          }
        />
      ) : (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-black text-ink">持仓明细</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                持有期年化以净值历史首日至今作为持有期估算；当日收益按「最新净值 − 前一净值」估算。
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Checkbox
                size="small"
                checked={onlyWithHolding}
                onChange={(event) => setOnlyWithHolding(event.target.checked)}
                sx={{ p: 0.5 }}
              />
              仅显示已录入持仓
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table min-w-[1080px]">
              <thead>
                <tr>
                  <th>产品</th>
                  <th className="text-right">份额</th>
                  <th className="text-right">成本净值</th>
                  <th className="text-right">当前净值</th>
                  <th className="text-right">市值</th>
                  <th className="text-right">持有收益</th>
                  <th className="text-right">持有收益率</th>
                  <th className="text-right">持有期年化</th>
                  <th className="text-right">当日收益估算</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ product, stats }) => (
                  <tr key={product.code}>
                    <td>
                      <div className="font-black text-ink">{product.code}</div>
                      <div className="mt-0.5 max-w-[200px] truncate text-xs text-muted">
                        {product.name || '未命名产品'}
                      </div>
                    </td>
                    {stats ? (
                      <>
                        <td className="text-right">{fmtMoney(stats.shares, 2)}</td>
                        <td className="text-right">{fmtNav(stats.costNav)}</td>
                        <td className="text-right">
                          {fmtNav(stats.latestNav)}
                          <div className="text-[11px] text-faint">{stats.latestDate}</div>
                        </td>
                        <td className="text-right font-bold">{fmtMoney(stats.marketValue)}</td>
                        <td className={`text-right font-bold ${moneyTone(stats.profit)}`}>
                          {fmtMoney(stats.profit)}
                        </td>
                        <td className={`text-right font-bold ${moneyTone(stats.profitRate)}`}>
                          {fmtPercent(stats.profitRate)}
                        </td>
                        <td className={`text-right font-bold ${moneyTone(stats.holdingAnnualized)}`}>
                          {fmtPercent(stats.holdingAnnualized)}
                          <div className="text-[11px] text-faint">{stats.holdingDays} 天</div>
                        </td>
                        <td className={`text-right font-bold ${moneyTone(stats.dayProfit)}`}>
                          {fmtMoney(stats.dayProfit)}
                          <div className={`text-[11px] ${moneyTone(stats.dayRate)}`}>
                            {fmtPercent(stats.dayRate, 2)}
                          </div>
                        </td>
                      </>
                    ) : (
                      <td className="text-right text-xs text-faint" colSpan={8}>
                        未录入持仓
                      </td>
                    )}
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setDialog({ open: true, product })}
                      >
                        {stats ? '编辑持仓' : '录入持仓'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <HoldingDialog
        open={dialog.open}
        product={dialogProduct}
        latestNav={dialogLatest}
        onSubmit={handleHoldingSubmit}
        onClose={() => setDialog({ open: false, product: null })}
      />
    </div>
  );
}
