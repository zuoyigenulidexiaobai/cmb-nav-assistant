import React from 'react';
import { fmtDateTime } from '../lib/format.js';

/**
 * 概览指标卡：产品数 / 已更新 / 低于阈值 / 未更新。
 * @param {{stats:object, report:object}} props
 */
export default function SummaryCards({ stats, report }) {
  const cards = [
    {
      label: '监控产品数',
      value: stats.total,
      hint: '在监控清单中的产品',
      tone: 'text-ink',
      accent: 'bg-brand-500',
    },
    {
      label: '已更新到披露日',
      value: stats.updated,
      hint: `应披露日 ${report?.expectedDisclosureDate || '—'}`,
      tone: 'text-loss',
      accent: 'bg-loss',
    },
    {
      label: '低于阈值',
      value: stats.underThreshold,
      hint: '年化收益率低于设定阈值',
      tone: stats.underThreshold > 0 ? 'text-profit' : 'text-ink',
      accent: 'bg-profit',
    },
    {
      label: '未更新',
      value: stats.stale,
      hint: '最新净值早于应披露日',
      tone: stats.stale > 0 ? 'text-warn' : 'text-ink',
      accent: 'bg-warn',
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="card relative overflow-hidden p-4">
          <span className={`absolute left-0 top-0 h-full w-1 ${card.accent}`} aria-hidden="true" />
          <p className="text-xs font-semibold text-muted">{card.label}</p>
          <p className={`mt-2 text-3xl font-black leading-none ${card.tone}`}>{card.value}</p>
          <p className="mt-2 text-[11px] text-faint">{card.hint}</p>
        </div>
      ))}
      <p className="col-span-2 text-[11px] text-faint lg:col-span-4">
        最近计算时间 {fmtDateTime(report?.queryTime)} ·{' '}
        {report?.businessDay ? '今日为工作日' : '今日为周末 / 节假日，按上一工作日计算'}
      </p>
    </section>
  );
}
