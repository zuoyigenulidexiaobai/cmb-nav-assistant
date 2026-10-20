import React from 'react';
import { fmtRate, fmtShortDate } from '../lib/format.js';

/**
 * 单个周期的年化收益率展示（含基准日与实际天数）。
 * @param {{label:string, period:object|null}} props
 */
export function RateCell({ label, period }) {
  const labelNode = label ? (
    <span className="block text-[11px] font-bold text-muted">{label}</span>
  ) : null;
  if (!period || !Number.isFinite(period.rate)) {
    return (
      <div>
        {labelNode}
        <span className="mt-1 block text-sm font-black text-faint">—</span>
        <span className="mt-0.5 block text-[10px] text-faint">暂无基准</span>
      </div>
    );
  }
  return (
    <div>
      {labelNode}
      <span
        className={`mt-1 block text-sm font-black ${
          period.underThreshold ? 'text-profit' : 'text-ink'
        }`}
      >
        {fmtRate(period.rate)}
      </span>
      <span className="mt-0.5 block text-[10px] text-faint">
        相比 {fmtShortDate(period.baseDate)} / {period.actualDays} 天
      </span>
    </div>
  );
}

/**
 * 产品状态标签组。
 * @param {{result:object}} props
 */
export function StatusPills({ result }) {
  if (!result || result.status === 'nodata') {
    return <span className="pill pill-neutral">无数据</span>;
  }
  const pills = [];
  if (result.underThreshold) {
    pills.push(
      <span key="under" className="pill pill-alert">
        低于阈值
      </span>,
    );
  }
  if (result.stale) {
    pills.push(
      <span key="stale" className="pill pill-warn">
        未更新
      </span>,
    );
  }
  if (!result.underThreshold && !result.stale) {
    pills.push(
      <span key="ok" className="pill pill-ok">
        正常
      </span>,
    );
  }
  return <span className="flex flex-wrap justify-end gap-1.5">{pills}</span>;
}

/**
 * 空状态卡片。
 * @param {{title:string, description?:string, action?:React.ReactNode, icon?:string}} props
 */
export function EmptyState({ title, description, action }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl font-black text-brand-500"
        aria-hidden="true"
      >
        ⌁
      </span>
      <p className="text-base font-bold text-ink">{title}</p>
      {description ? (
        <p className="max-w-md text-xs leading-relaxed text-muted">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

/**
 * 页面标题区。
 * @param {{eyebrow:string, title:string, description?:string, actions?:React.ReactNode}} props
 */
export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-brand-600">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-black leading-tight text-ink md:text-[28px]">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
