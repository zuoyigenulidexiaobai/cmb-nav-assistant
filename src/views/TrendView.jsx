import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../hooks/usePortfolio.js';
import TrendChart, { seriesColor } from '../components/TrendChart.jsx';
import DailyReturnChart from '../components/DailyReturnChart.jsx';
import { HEAT_LABELS } from './BuyCheck.jsx';
import { EmptyState, PageHeader, RateCell } from '../components/common.jsx';
import { PERIODS } from '../lib/netvalue.js';
import { addDaysIso } from '../lib/holidays.js';
import { dailyReturns, evaluateHeat, isHotLevel } from '../lib/momentum.js';
import { fmtMonthDay, fmtNav, fmtPercent, fmtShortDate, trendClass } from '../lib/format.js';

/** 区间选择。 */
const RANGES = [
  { key: 'm1', label: '近 1 月', days: 30 },
  { key: 'm3', label: '近 3 月', days: 90 },
  { key: 'm6', label: '近 6 月', days: 180 },
  { key: 'all', label: '全部', days: null },
];

/** 视图模式：净值曲线 / 每日涨跌。 */
const MODES = [
  { key: 'nav', label: '净值曲线' },
  { key: 'daily', label: '每日涨跌' },
];

/** 尖峰阈值下拉选项（小数）。 */
const SPIKE_OPTIONS = [
  { value: 0.005, label: '0.5%' },
  { value: 0.01, label: '1.0%' },
  { value: 0.02, label: '2.0%' },
  { value: 0.03, label: '3.0%' },
];

/**
 * 热度档位的中文名（文案唯一来源是 views/BuyCheck.jsx 的 HEAT_LABELS）。
 * @param {string} level 英文档位 key
 * @returns {string} 中文名
 */
function heatLevelLabel(level) {
  return HEAT_LABELS[level]?.label || '';
}

/**
 * 为单条异动记录生成一句归因提示。
 *
 * @param {object} record 单日涨跌记录（含 ret）
 * @param {{
 *   avgAbsRet: number|null,
 *   maxIdx: number,
 *   minIdx: number,
 *   index: number,
 *   spikeThreshold: number,
 * }} context 归因上下文；`index` 为当前记录在区间内的下标，
 *   `maxIdx` / `minIdx` 为极值所在下标（用下标而非浮点全等比较，避免两日 ret 完全相同时只认第一个）
 * @returns {string} 中文说明
 */
function describeMove(record, context) {
  const { avgAbsRet, maxIdx, minIdx, index, spikeThreshold } = context;
  if (index === maxIdx && record.ret > 0) return '区间内最大单日涨幅';
  if (index === minIdx && record.ret < 0) return '区间内最大单日跌幅';
  if (Number.isFinite(avgAbsRet) && avgAbsRet > 0) {
    const ratio = record.ret / avgAbsRet;
    if (ratio >= 5) return `单日涨幅超过区间日均 ${ratio.toFixed(1)} 倍，属异常尖峰`;
    if (ratio >= 3) return `单日涨幅约为区间日均 ${ratio.toFixed(1)} 倍，明显偏离常态`;
  }
  if (record.ret >= 0.02) return '单日涨幅较大，注意是否有分红/折算等因素';
  if (record.ret >= spikeThreshold) return '单日涨幅超过尖峰阈值';
  return '单日跌幅超过阈值，注意回撤';
}

/**
 * 净值走势视图：多产品叠加对比 + 每日涨跌 + 尖峰归因 + 年化收益率摘要。
 * @param {{notify: Function, onNavigate: Function}} props
 */
export default function TrendView({ onNavigate }) {
  const { products, evaluations } = usePortfolio();
  const [rangeKey, setRangeKey] = useState('m3');
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [mode, setMode] = useState('nav');
  const [spikeThreshold, setSpikeThreshold] = useState(0.01);
  const [pickedCode, setPickedCode] = useState('');
  const [activeDate, setActiveDate] = useState(null);

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

  /** 当前区间内参与对比的产品（含裁剪后的净值点）。 */
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
    const isSelected = selectedCodes.includes(code);
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
    // 取消勾选的产品如果正好是当前聚焦对象，一并清掉焦点，
    // 否则重新勾选时焦点会跳回旧产品，看起来像「自己跑过去的」。
    if (isSelected && pickedCode === code) {
      setPickedCode('');
      setActiveDate(null);
    }
  };

  const evaluationMap = useMemo(() => {
    const map = new Map();
    for (const item of evaluations) map.set(item.product.code, item.result);
    return map;
  }, [evaluations]);

  /**
   * 每日涨跌数据集：对区间内每只产品计算单日涨跌。
   * 「前一日净值」优先取区间之前的点，避免区间首日缺失基准。
   */
  const dailySets = useMemo(() => {
    if (mode !== 'daily') return [];
    return series.map((item) => {
      const firstDate = item.points[0]?.date;
      const index = item.full.findIndex((point) => point.date === firstDate);
      const withPrev = index > 0 ? [item.full[index - 1], ...item.points] : item.points.slice();
      const returns = dailyReturns(withPrev).filter(
        (point) => point.date >= firstDate && Number.isFinite(point.ret),
      );
      let maxRet = null;
      let minRet = null;
      let maxIdx = -1;
      let minIdx = -1;
      returns.forEach((point, pointIndex) => {
        if (maxRet === null || point.ret > maxRet) {
          maxRet = point.ret;
          maxIdx = pointIndex;
        }
        if (minRet === null || point.ret < minRet) {
          minRet = point.ret;
          minIdx = pointIndex;
        }
      });
      return {
        code: item.code,
        name: item.name,
        points: returns,
        maxRet,
        minRet,
        maxIdx,
        minIdx,
        days: returns.length,
        spikeCount: returns.filter((point) => point.ret >= spikeThreshold).length,
        // 极值日期按下标取，避免浮点全等比较（两日 ret 完全相同只会命中第一个）。
        maxDate: maxIdx >= 0 ? returns[maxIdx].date : null,
      };
    });
  }, [series, mode, spikeThreshold]);

  /** 当前聚焦的产品（异动明细 / 柱状图都只看它，避免多产品叠加看不清）。 */
  const focusCode = useMemo(() => {
    if (pickedCode && dailySets.some((item) => item.code === pickedCode)) return pickedCode;
    return dailySets[0]?.code || '';
  }, [pickedCode, dailySets]);

  const focusSet = useMemo(
    () => dailySets.find((item) => item.code === focusCode) || null,
    [dailySets, focusCode],
  );

  /** 异动明细：|单日涨跌| ≥ 阈值，按绝对值降序。 */
  const moveRows = useMemo(() => {
    if (!focusSet) return [];
    const avgAbsRet =
      focusSet.points.length > 0
        ? focusSet.points.reduce((sum, point) => sum + Math.abs(point.ret), 0) / focusSet.points.length
        : null;
    const context = {
      avgAbsRet,
      maxIdx: focusSet.maxIdx,
      minIdx: focusSet.minIdx,
      spikeThreshold,
    };
    return focusSet.points
      .map((point, index) => ({
        ...point,
        index,
        code: focusSet.code,
        name: focusSet.name,
      }))
      .filter((point) => Math.abs(point.ret) >= spikeThreshold)
      .map((point) => ({
        ...point,
        note: describeMove(point, context),
      }))
      .sort((a, b) => Math.abs(b.ret) - Math.abs(a.ret));
  }, [focusSet, spikeThreshold]);

  /** 热度评估（用于提示条 + 产品芯片上的「热」标记，含很热 / 严重过热两档）。 */
  const heatMap = useMemo(() => {
    const map = new Map();
    for (const item of activeProducts) {
      const heat = evaluateHeat(item, { spikeThreshold });
      map.set(item.code, heat);
    }
    return map;
  }, [activeProducts, spikeThreshold]);

  const hotSelected = useMemo(
    () =>
      selectedCodes.filter((code) => {
        const heat = heatMap.get(code);
        return heat ? isHotLevel(heat.heatLevel) : false;
      }),
    [selectedCodes, heatMap],
  );

  // 区间切换 / 产品变更后，之前选中的参考线日期可能已不在区间内。
  useEffect(() => {
    if (!activeDate) return;
    if (!focusSet || !focusSet.points.some((point) => point.date === activeDate)) {
      setActiveDate(null);
    }
  }, [focusSet, activeDate]);

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

  const summaryText = focusSet
    ? `区间内共 ${focusSet.days} 个交易日 · 涨幅≥阈值 ${focusSet.spikeCount} 次 · 最大单日涨幅 ${
        Number.isFinite(focusSet.maxRet) ? (focusSet.maxRet * 100).toFixed(2) : '—'
      }%${focusSet.maxDate ? `（${focusSet.maxDate}，${focusSet.code}）` : ''}`
    : '区间内净值点不足 2 个，无法计算单日涨跌';

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Trend"
        title="净值走势"
        description="多产品净值曲线叠加对比，也可切到「每日涨跌」逐日看波动与尖峰。区间内上涨为红色、下跌为绿色（国内习惯）。"
      />

      {hotSelected.length > 0 ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 border border-red-200 bg-red-50/70 px-4 py-3">
          <p className="text-xs font-bold text-profit">
            ⚠ {hotSelected.join('、')} 近期涨幅偏大（很热及以上档位），买入前建议先做一次体检，避免在尖峰后进场
          </p>
          <button
            type="button"
            onClick={() => onNavigate?.('buycheck')}
            className="rounded-lg bg-profit px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
          >
            查看「买前体检」
          </button>
        </div>
      ) : null}

      <div className="card grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {MODES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={mode === item.key}
                  onClick={() => {
                    // 切模式时清掉参考线日期：否则切回来旧竖线又被点亮，像是刚点的。
                    // 只清日期，不动 selectedCodes，保留用户的产品勾选。
                    setMode(item.key);
                    setActiveDate(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    mode === item.key
                      ? 'bg-brand-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'daily' ? (
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                尖峰阈值
                <select
                  value={String(spikeThreshold)}
                  onChange={(event) => setSpikeThreshold(Number(event.target.value))}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-[11px] font-bold text-ink"
                >
                  {SPIKE_OPTIONS.map((option) => (
                    <option key={option.value} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="text-[11px] text-faint">
              数据最新日期 {referenceDate || '—'}
              {cutoff ? ` · 显示 ${cutoff} 之后` : ' · 显示全部历史'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {activeProducts.map((item) => {
            const checked = selectedCodes.includes(item.code);
            const fullPoints = item.history;
            const color = seriesColor(
              cutoff ? fullPoints.filter((point) => point.date >= cutoff) : fullPoints,
            );
            const heat = heatMap.get(item.code);
            const hot = heat ? isHotLevel(heat.heatLevel) : false;
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
                {hot ? (
                  <span className="rounded-full bg-red-100 px-1 text-[9px] font-black text-profit">热</span>
                ) : null}
              </button>
            );
          })}
          {selectedCodes.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSelectedCodes([]);
                // 清空勾选后单产品焦点也一起清掉，避免下次勾选时焦点自动落回旧产品。
                setPickedCode('');
                setActiveDate(null);
              }}
              className="rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-muted transition hover:text-ink"
            >
              清空选择
            </button>
          ) : null}
        </div>

        {mode === 'nav' ? (
          <TrendChart series={series} height={420} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50/70 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-muted">查看产品：</span>
                {dailySets.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setPickedCode(item.code);
                      setActiveDate(null);
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
                      focusCode === item.code
                        ? 'bg-brand-500 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item.code}
                  </button>
                ))}
                {dailySets.length === 0 ? (
                  <span className="text-xs text-faint">请先选择至少一只产品</span>
                ) : null}
              </div>
              <p className="text-[11px] text-faint">
                红柱上涨、绿柱下跌；深红柱为达到尖峰阈值（≥ {(spikeThreshold * 100).toFixed(1)}%）
              </p>
            </div>

            {focusSet && focusSet.points.length > 0 ? (
              <DailyReturnChart
                points={focusSet.points}
                spikeThreshold={spikeThreshold}
                activeDate={activeDate}
                activeCode={focusSet.code}
                height={340}
              />
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted">
                区间内净值点不足 2 个，无法计算单日涨跌
              </div>
            )}
          </>
        )}
      </div>

      {mode === 'daily' ? (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-black text-ink">异动明细</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                {focusSet ? `${focusSet.code} · ${summaryText}` : '请先选择需要查看的产品'}
              </p>
            </div>
            <p className="text-[11px] text-faint">点击任意一行，可在图上定位该日期（竖虚线）</p>
          </div>

          {moveRows.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted">
              该区间内没有单日涨跌达到 {spikeThreshold * 100}% 的记录，走势相对平稳
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>日期</th>
                    <th className="text-right">当日涨跌%</th>
                    <th className="text-right">前一日净值</th>
                    <th className="text-right">当日净值</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {moveRows.map((row) => {
                    const selected = activeDate === row.date;
                    return (
                      <tr
                        key={`${row.code}-${row.date}`}
                        onClick={() => setActiveDate(selected ? null : row.date)}
                        className={`cursor-pointer transition ${selected ? 'bg-brand-50' : ''}`}
                      >
                        <td>
                          <div className="font-black text-ink">{row.code}</div>
                          <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-muted">
                            {row.name || '未命名产品'}
                          </div>
                        </td>
                        <td className={selected ? 'font-bold text-brand-600' : 'text-ink'}>
                          {row.date}
                          <div className="text-[11px] text-faint">{fmtShortDate(row.date)}</div>
                        </td>
                        <td className={`text-right font-black ${trendClass(row.ret)}`}>
                          {fmtPercent(row.ret, 2)}
                          {row.ret >= spikeThreshold ? (
                            <span className="ml-1 text-[10px] font-bold">⚠</span>
                          ) : null}
                        </td>
                        <td className="text-right text-muted">{fmtNav(row.prevNav)}</td>
                        <td className="text-right text-ink">{fmtNav(row.nav)}</td>
                        <td className="text-xs text-muted">{row.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

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
              const heat = heatMap.get(code);
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
                  {heat && isHotLevel(heat.heatLevel) ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] leading-relaxed text-profit">
                      ⚠ 该产品近期涨幅偏大（{heatLevelLabel(heat.heatLevel)}档）
                      {heat.maxDaily ? `（最大单日 ${fmtPercent(heat.maxDaily.ret, 2)}，${fmtMonthDay(heat.maxDaily.date)}）` : ''}
                      ，建议查看「买前体检」
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
