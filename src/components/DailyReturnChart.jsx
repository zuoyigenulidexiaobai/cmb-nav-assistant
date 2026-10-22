import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtNav, fmtShortDate } from '../lib/format.js';

/** 国内习惯：涨=红，跌=绿。 */
const UP_COLOR = '#d83a3a';
const DOWN_COLOR = '#168355';
const FLAT_COLOR = '#8a97ab';
/** 尖峰柱：红色加深，醒目但仍属同一色系。 */
const SPIKE_COLOR = '#9d1c1c';

/**
 * 单只产品「每日涨跌」柱状图。
 *
 * 数据来源为 `dailyReturns()` 的返回值（首个点 ret 为 null，不绘制）。
 * 上涨红柱、下跌绿柱；单日涨幅 ≥ `spikeThreshold` 的柱子用深红强调。
 *
 * @param {{
 *   points: Array<{date:string, nav:number, prevNav:number|null, ret:number|null}>,
 *   spikeThreshold?: number,
 *   activeDate?: string|null,
 *   activeCode?: string,
 *   height?: number,
 * }} props
 */
export default function DailyReturnChart({
  points,
  spikeThreshold = 0.01,
  activeDate = null,
  activeCode = '',
  height = 320,
}) {
  const rows = useMemo(() => {
    if (!Array.isArray(points)) return [];
    return points
      .filter((point) => point && Number.isFinite(point.ret))
      .map((point) => ({
        date: point.date,
        ret: point.ret,
        percent: Number((point.ret * 100).toFixed(4)),
        nav: point.nav,
        prevNav: point.prevNav,
        spike: point.ret >= spikeThreshold,
      }));
  }, [points, spikeThreshold]);

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted">
        区间内净值点不足 2 个，无法计算单日涨跌
      </div>
    );
  }

  const values = rows.map((row) => row.percent);
  const maxAbs = Math.max(1, ...values.map((value) => Math.abs(value)));
  const domain = maxAbs * 1.25;

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#eef3fb" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtShortDate}
            tick={{ fontSize: 11, fill: '#65738a' }}
            minTickGap={28}
            axisLine={{ stroke: '#dbe3ee' }}
            tickLine={false}
          />
          <YAxis
            domain={[-domain, domain]}
            tick={{ fontSize: 11, fill: '#65738a' }}
            tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
            width={54}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(47,107,255,0.06)' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0].payload;
              const tone = row.ret > 0 ? UP_COLOR : row.ret < 0 ? DOWN_COLOR : FLAT_COLOR;
              return (
                <div className="rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-card">
                  <p className="font-bold text-ink">{activeCode ? `${activeCode} · ${row.date}` : row.date}</p>
                  <p className="mt-1" style={{ color: tone }}>
                    单日涨跌 {row.percent > 0 ? '+' : ''}
                    {row.percent.toFixed(2)}%
                  </p>
                  <p className="mt-0.5 text-muted">
                    {fmtNav(row.prevNav)} → {fmtNav(row.nav)}
                  </p>
                  {row.spike ? (
                    <p className="mt-1 font-bold" style={{ color: SPIKE_COLOR }}>
                      ⚠ 尖峰（≥ {(spikeThreshold * 100).toFixed(1)}%）
                    </p>
                  ) : null}
                </div>
              );
            }}
          />
          <ReferenceLine y={0} stroke="#c8d4e4" />
          {activeDate && rows.some((row) => row.date === activeDate) ? (
            <ReferenceLine
              x={activeDate}
              stroke="#2f6bff"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              label={{ value: '选中', position: 'insideTop', fill: '#2f6bff', fontSize: 10 }}
            />
          ) : null}
          <Bar dataKey="percent" name="单日涨跌" maxBarSize={26} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.date}
                fill={
                  row.spike ? SPIKE_COLOR : row.ret > 0 ? UP_COLOR : row.ret < 0 ? DOWN_COLOR : FLAT_COLOR
                }
                stroke={row.date === activeDate ? '#2f6bff' : 'none'}
                strokeWidth={row.date === activeDate ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
