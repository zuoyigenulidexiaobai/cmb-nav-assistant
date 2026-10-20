import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtNav, fmtShortDate } from '../lib/format.js';

/**
 * 多产品净值走势图。
 *
 * 配色遵守国内习惯：区间内净值上涨 → 红，下跌 → 绿。
 *
 * @param {{
 *   series: Array<{code:string, name:string, color:string, points:Array<{date:string,nav:number}>}>,
 *   height?: number,
 * }} props
 */
export default function TrendChart({ series, height = 400 }) {
  const rows = useMemo(() => {
    const dateSet = new Set();
    for (const item of series) {
      for (const point of item.points) dateSet.add(point.date);
    }
    const dates = Array.from(dateSet).sort();
    return dates.map((date) => {
      /** @type {Record<string, number|string>} */
      const row = { date };
      for (const item of series) {
        const hit = item.points.find((point) => point.date === date);
        if (hit) row[item.code] = hit.nav;
      }
      return row;
    });
  }, [series]);

  if (!series.length || rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        暂无可绘制的净值数据
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#eef3fb" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtShortDate}
            tick={{ fontSize: 11, fill: '#65738a' }}
            minTickGap={24}
            axisLine={{ stroke: '#dbe3ee' }}
            tickLine={false}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 11, fill: '#65738a' }}
            tickFormatter={(value) => Number(value).toFixed(3)}
            width={58}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value, name) => [fmtNav(Number(value)), name]}
            labelFormatter={(label) => `净值日期 ${label}`}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #dbe3ee',
              fontSize: 12,
              boxShadow: '0 10px 30px rgba(40,64,102,0.12)',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            iconType="plainline"
          />
          {series.map((item) => (
            <Line
              key={item.code}
              type="monotone"
              dataKey={item.code}
              name={item.name ? `${item.code} ${item.name}` : item.code}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * 依据区间内首尾净值判断涨跌配色（涨红跌绿）。
 * @param {Array<{date:string,nav:number}>} points
 * @returns {string}
 */
export function seriesColor(points) {
  if (!points || points.length < 2) return '#65738a';
  const first = points[0].nav;
  const last = points[points.length - 1].nav;
  if (last > first) return '#d83a3a';
  if (last < first) return '#168355';
  return '#65738a';
}
