import React, { useMemo, useState } from 'react';
import Checkbox from '@mui/material/Checkbox';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePortfolio } from '../hooks/usePortfolio.js';
import { EmptyState, PageHeader } from '../components/common.jsx';
import { DEFAULT_SPIKE_THRESHOLD, dailyReturns, isHotLevel, rankByHeat } from '../lib/momentum.js';
import { fmtMonthDay, fmtNav, fmtPercent, fmtShortDate, trendClass } from '../lib/format.js';

/** 国内习惯：涨=红，跌=绿。 */
const UP_COLOR = '#d83a3a';
const DOWN_COLOR = '#168355';
const FLAT_COLOR = '#8a97ab';

/**
 * 热度档位的中文映射（与 lib/momentum.js 的 HEAT_LEVELS 一一对应）。
 * 文案刻意写成「人话」，让用户不用理解分数也能判断该不该买。
 * 注意：hot 用「很热」而不是「过热」，避免与「过热」这个笼统说法混淆，
 * 保证 UI 里每个中文词只对应一个档位（很热 = hot，严重过热 = overheat）。
 */
export const HEAT_LABELS = {
  cold: { label: '冷静', hint: '短期没怎么涨，可分批建仓', color: '#3473f5' },
  normal: { label: '中性', hint: '涨幅温和，可按计划买入', color: '#65738a' },
  warm: { label: '偏热', hint: '短期涨幅偏大，谨慎追高', color: '#d97706' },
  hot: { label: '很热', hint: '近期涨幅明显偏大，建议等回调', color: '#e2591f' },
  overheat: { label: '严重过热', hint: '短期涨太猛，暂缓买入', color: '#d83a3a' },
};

/**
 * 读取某个档位的展示信息（未命中时回落到「冷静」）。
 * @param {string} level
 * @returns {{label:string, hint:string, color:string}}
 */
function heatStyle(level) {
  return HEAT_LABELS[level] || HEAT_LABELS.cold;
}

/**
 * 近 N 个交易日的迷你涨跌柱状图（用于展开行内）。
 * @param {{points: Array<{date:string, nav:number, prevNav:number|null, ret:number|null}>, height?: number}} props
 */
function MiniReturnChart({ points, height = 120 }) {
  const rows = useMemo(() => {
    if (!Array.isArray(points)) return [];
    return points
      .filter((point) => Number.isFinite(point.ret))
      .map((point) => ({
        date: point.date,
        percent: Number((point.ret * 100).toFixed(4)),
        ret: point.ret,
      }));
  }, [points]);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-[11px] text-faint">近期净值点不足，无法绘制</p>;
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={{ fontSize: 9, fill: '#8a97ab' }} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis width={38} tick={{ fontSize: 9, fill: '#8a97ab' }} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} tickLine={false} axisLine={false} />
          <ReferenceLine y={0} stroke="#c8d4e4" />
          <Tooltip
            cursor={{ fill: 'rgba(47,107,255,0.06)' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0].payload;
              return (
                <div className="rounded-lg border border-line bg-white px-2 py-1 text-[11px] shadow-card">
                  <p className="font-bold text-ink">{row.date}</p>
                  <p className={trendClass(row.ret)}>单日 {fmtPercent(row.ret, 2)}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="percent" maxBarSize={12} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.date} fill={row.ret > 0 ? UP_COLOR : row.ret < 0 ? DOWN_COLOR : FLAT_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * 买前体检视图：按「涨过头」热度从冷到热排列，帮助用户在买入前规避尖峰。
 * @param {{notify?: Function, onNavigate?: Function}} props
 */
export default function BuyCheck({ onNavigate }) {
  const { products } = usePortfolio();
  const [onlyHot, setOnlyHot] = useState(false);
  const [onlyHolding, setOnlyHolding] = useState(false);
  const [expandedCode, setExpandedCode] = useState('');

  /** 只体检监控中的产品（归档产品不参与买前决策）。 */
  const candidates = useMemo(
    () => products.filter((item) => item.active && item.history.length > 0),
    [products],
  );

  const ranked = useMemo(
    () => rankByHeat(candidates, { spikeThreshold: DEFAULT_SPIKE_THRESHOLD }),
    [candidates],
  );

  const summary = useMemo(() => {
    const hotCount = ranked.filter((item) => isHotLevel(item.heatLevel)).length;
    const spikeCount = ranked.filter((item) => item.spikeDays.length > 0).length;
    const coldest = ranked[0] || null;
    return { total: ranked.length, hotCount, spikeCount, coldest };
  }, [ranked]);

  const visibleRows = useMemo(
    () =>
      ranked.filter((item) => {
        if (onlyHot && !isHotLevel(item.heatLevel)) return false;
        if (onlyHolding && !item.hasHolding) return false;
        return true;
      }),
    [ranked, onlyHot, onlyHolding],
  );

  const expanded = useMemo(() => {
    const hit = ranked.find((item) => item.code === expandedCode);
    if (!hit) return null;
    const product = candidates.find((item) => item.code === hit.code);
    const recent = dailyReturns(product?.history || []).slice(-30);
    return { heat: hit, recent };
  }, [ranked, expandedCode, candidates]);

  if (products.length === 0) {
    return (
      <div className="grid gap-5">
        <PageHeader
          eyebrow="Buy Check"
          title="买前体检"
          description="买入前先看有没有「短期涨过头」，避免在尖峰后进场。"
        />
        <EmptyState
          title="暂无产品可体检"
          description="请先在「净值管理」中录入产品与净值，或前往「数据管理」导入历史数据。"
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
        eyebrow="Buy Check"
        title="买前体检"
        description="买入前先看有没有「短期涨过头」：按近 5 / 20 / 60 日累计涨幅、单日尖峰与年化变化算一个热度分，越冷越靠前，避免在尖峰后进场。"
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">体检产品数</p>
          <p className="mt-2 text-2xl font-black text-ink">{summary.total}</p>
          <p className="mt-1 text-[11px] text-faint">监控中且有净值历史</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">很热 / 严重过热（需谨慎）</p>
          <p className={`mt-2 text-2xl font-black ${summary.hotCount > 0 ? 'text-profit' : 'text-ink'}`}>
            {summary.hotCount}
          </p>
          <p className="mt-1 text-[11px] text-faint">热度 ≥ 70（很热 + 严重过热）</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">近期出现尖峰</p>
          <p className={`mt-2 text-2xl font-black ${summary.spikeCount > 0 ? 'text-profit' : 'text-ink'}`}>
            {summary.spikeCount}
          </p>
          <p className="mt-1 text-[11px] text-faint">单日涨幅曾 ≥ {(DEFAULT_SPIKE_THRESHOLD * 100).toFixed(1)}%</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">最「冷」的产品</p>
          <p className="mt-2 truncate text-2xl font-black text-ink">
            {summary.coldest ? summary.coldest.code : '—'}
          </p>
          <p className="mt-1 text-[11px] text-faint">
            {summary.coldest ? `热度 ${summary.coldest.heatScore} 分 · ${heatStyle(summary.coldest.heatLevel).label}` : '暂无数据'}
          </p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-black text-ink">热度排行（从冷到热）</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              点击任意一行查看判断依据与最近 30 个交易日的涨跌
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Checkbox
                size="small"
                checked={onlyHot}
                onChange={(event) => setOnlyHot(event.target.checked)}
                sx={{ p: 0.5 }}
              />
              只看很热及以上
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Checkbox
                size="small"
                checked={onlyHolding}
                onChange={(event) => setOnlyHolding(event.target.checked)}
                sx={{ p: 0.5 }}
              />
              只看有持仓
            </label>
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted">
            没有符合筛选条件的产品，试着取消勾选上面的过滤条件
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1080px]">
              <thead>
                <tr>
                  <th>产品</th>
                  <th className="w-[180px]">热度</th>
                  <th className="text-right">近 5 日</th>
                  <th className="text-right">近 20 日</th>
                  <th className="text-right">近 60 日</th>
                  <th className="text-right">近 20 日年化</th>
                  <th className="text-right">最大单日</th>
                  <th>结论</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const style = heatStyle(row.heatLevel);
                  const hot = isHotLevel(row.heatLevel);
                  const isOpen = expandedCode === row.code;
                  return (
                    <React.Fragment key={row.code}>
                      <tr
                        onClick={() => setExpandedCode(isOpen ? '' : row.code)}
                        className={`cursor-pointer transition ${isOpen ? 'bg-brand-50' : ''}`}
                      >
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="font-black text-ink">{row.code}</span>
                            {row.hasHolding ? (
                              <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-bold text-brand-600">
                                持仓
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 max-w-[200px] truncate text-xs text-muted">
                            {row.name || '未命名产品'}
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-[86px] overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.max(4, row.heatScore)}%`, backgroundColor: style.color }}
                              />
                            </div>
                            <span className="text-xs font-black" style={{ color: style.color }}>
                              {row.heatScore}
                            </span>
                            {row.flags.includes('shortHistory') ? (
                              <span className="text-[10px] font-semibold text-faint">样本少</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[11px]" style={{ color: style.color }}>
                            {style.label} · {style.hint}
                          </div>
                        </td>
                        <td className={`text-right font-bold ${trendClass(row.cum5)}`}>
                          {fmtPercent(row.cum5, 2)}
                          <div className="text-[10px] text-faint">{row.days5} 个交易日</div>
                        </td>
                        <td className={`text-right font-bold ${trendClass(row.cum20)}`}>
                          {fmtPercent(row.cum20, 2)}
                          <div className="text-[10px] text-faint">{row.days20} 个交易日</div>
                        </td>
                        <td className={`text-right font-bold ${trendClass(row.cum60)}`}>
                          {fmtPercent(row.cum60, 2)}
                          <div className="text-[10px] text-faint">{row.days60} 个交易日</div>
                        </td>
                        <td className={`text-right font-bold ${trendClass(row.annualized20)}`}>
                          {fmtPercent(row.annualized20, 1)}
                        </td>
                        <td className="text-right">
                          <span className={`font-bold ${trendClass(row.maxDaily?.ret)}`}>
                            {row.maxDaily ? fmtPercent(row.maxDaily.ret, 2) : '—'}
                          </span>
                          <div className="text-[10px] text-faint">
                            {row.maxDaily ? fmtMonthDay(row.maxDaily.date) : '—'}
                          </div>
                        </td>
                        <td>
                          <p className={`text-xs font-bold ${hot ? 'text-profit' : 'text-ink'}`}>
                            {row.suggestion}
                          </p>
                          <div className="mt-0.5 text-[10px] text-faint">
                            {row.spikeDays.length > 0 ? `尖峰 ${row.spikeDays.length} 次` : '无单日尖峰'}
                            {row.newHigh ? ' · 处于新高' : ''}
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={8} className="bg-slate-50/60">
                            <div className="grid gap-4 py-1 lg:grid-cols-[1fr_320px]">
                              <div>
                                <p className="text-xs font-black text-ink">判断依据</p>
                                <ul className="mt-1.5 grid gap-1">
                                  {row.reasons.map((reason) => (
                                    <li key={reason} className="text-[11px] leading-relaxed text-muted">
                                      · {reason}
                                    </li>
                                  ))}
                                </ul>
                                {row.spikeDays.length > 0 ? (
                                  <p className="mt-2 text-[11px] leading-relaxed text-profit">
                                    ⚠ 需要警惕的尖峰：
                                    {row.spikeDays
                                      .slice(0, 4)
                                      .map((day) => `${fmtMonthDay(day.date)} ${fmtPercent(day.ret, 2)}`)
                                      .join('、')}
                                  </p>
                                ) : null}
                                <p className="mt-2 text-[11px] text-faint">
                                  最新净值 {fmtNav(row.latestNav)} · {row.latestDate || '—'} · 共 {row.days} 个交易日
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-black text-ink">最近 30 个交易日涨跌</p>
                                <MiniReturnChart points={expanded?.heat.code === row.code ? expanded.recent : []} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-faint">
        热度分只看「短期涨幅是否过大」，不代表产品好坏；分档：冷静 &lt; 30 · 中性 30–50 · 偏热 50–70 · 很热 70–85 ·
        严重过热 ≥ 85。历史不足 20 个交易日的产品会标「样本少」，结论仅作参考；不构成投资建议。
      </p>
    </div>
  );
}
