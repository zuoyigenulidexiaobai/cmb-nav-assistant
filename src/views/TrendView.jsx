import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../hooks/usePortfolio.js';
import TrendChart, { seriesColor } from '../components/TrendChart.jsx';
import { EmptyState, PageHeader, RateCell } from '../components/common.jsx';
import { PERIODS } from '../lib/netvalue.js';
import { addDaysIso } from '../lib/holidays.js';
import { fmtNav } from '../lib/format.js';

const RANGES = [
  { key: 'm1', label: '近 1 月', days: 30 },
  { key: 'm3', label: '近 3 月', days: 90 },
  { key: 'm6', label: '近 6 月', days: 180 },
  { key: 'all', label: '全部', days: null },
];

/**
 * 净值走势视图：多产品叠加对比 + 年化收益率摘要。
 * @param {{notify: Function, onNavigate: Function}} props
 */
export default function TrendView({ onNavigate }) {
  const { products, evaluations } = usePortfolio();
  const [rangeKey, setRangeKey] = useState('m3');
  const [selectedCodes, setSelectedCodes] = useState([]);

  const activeProducts = useMemo(
    () => products.filter((item) => item.active && item.history.length > 0),
    [products],
  );

  const availableKey = activeProducts.map((item) => item.code).join(',');

  useEffect(() => {
    setSelectedCodes((prev) => {
      const available = activeProducts.map((item) => item.code);
      const kept = prev.filter((code) => available.includes(code));
      const added = available.filter((code) => !kept.includes(code));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableKey]);

  const referenceDate = useMemo(() => {
    let latest = '';
    for (const item of activeProducts) {
      const last = item.history[item.history.length - 1];
      if (last && last.date > latest) latest = last.date;
    }
    return latest;
  }, [activeProducts]);

  const range = RANGES.find((item) => item.key === rangeKey) || RANGES[1];

  const cutoff = useMemo(() => {
    if (!range.days || !referenceDate) return '';
    return addDaysIso(referenceDate, -range.days);
  }, [range.days, referenceDate]);

  const series = useMemo(() => {
    return activeProducts
      .filter((item) => selectedCodes.includes(item.code))
      .map((item) => {
        const points = cutoff
          ? item.history.filter((point) => point.date >= cutoff)
          : item.history;
        return {
          code: item.code,
          name: item.name || '',
          color: seriesColor(points),
          points,
          full: item.history,
        };
      })
      .filter((item) => item.points.length > 0);
  }, [activeProducts, selectedCodes, cutoff]);

  const toggleCode = (code) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
  };

  const evaluationMap = useMemo(() => {
    const map = new Map();
    for (const item of evaluations) map.set(item.product.code, item.result);
    return map;
  }, [evaluations]);

  if (activeProducts.length === 0) {
    return (
      <div className="grid gap-5">
        <PageHeader
          eyebrow="Trend"
          title="净值走势"
          description="多产品净值曲线叠加对比，可选区间查看；区间内上涨为红色、下跌为绿色。"
        />
        <EmptyState
          title="暂无可绘制的产品"
          description="请先在「净值管理」中录入产品与净值，或前往「数据管理」导入插件历史数据。"
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
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Trend"
        title="净值走势"
        description="多产品净值曲线叠加对比。区间内上涨为红色、下跌为绿色（国内习惯）。"
      />

      <div className="card grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setRangeKey(item.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  rangeKey === item.key
                    ? 'bg-brand-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint">
            数据最新日期 {referenceDate || '—'}
            {cutoff ? ` · 显示 ${cutoff} 之后` : ' · 显示全部历史'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {activeProducts.map((item) => {
            const checked = selectedCodes.includes(item.code);
            const fullPoints = item.history;
            const color = seriesColor(
              cutoff ? fullPoints.filter((point) => point.date >= cutoff) : fullPoints,
            );
            return (
              <button
                key={item.code}
                type="button"
                aria-pressed={checked}
                onClick={() => toggleCode(item.code)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition ${
                  checked
                    ? 'border-brand-200 bg-brand-50 text-brand-700'
                    : 'border-line bg-white text-faint'
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border text-[9px] leading-none ${
                    checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {checked ? '✓' : ''}
                </span>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {item.code}
              </button>
            );
          })}
          {selectedCodes.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedCodes([])}
              className="rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-muted transition hover:text-ink"
            >
              清空选择
            </button>
          ) : null}
        </div>

        <TrendChart series={series} height={420} />
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-black text-ink">年化收益率摘要</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            已选 {selectedCodes.length} 只产品 · 近 1 / 2 / 4 周年化（低于阈值标红）
          </p>
        </div>
        {selectedCodes.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted">请先选择需要对比的产品</p>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {selectedCodes.map((code) => {
              const result = evaluationMap.get(code);
              const product = products.find((item) => item.code === code);
              if (!result) return null;
              return (
                <div key={code} className="rounded-xl border border-line p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-black text-ink">{code}</span>
                    <span className="text-xs text-muted">
                      最新 {fmtNav(result.latestNav)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-faint">
                    {product?.name || '未命名产品'} · {result.latestDate || '—'}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {PERIODS.map((period) => (
                      <div key={period.key} className="min-w-0">
                        <RateCell label={period.label} period={result.periods?.[period.key]} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
