import React from 'react';
import { fmtPercent } from '../lib/format.js';

/**
 * 顶部警示条：低于阈值 / 未更新 / 空状态 / 全部正常。
 * @param {{report:object, stats:object, settings:object, onNavigate:Function}} props
 */
export default function AlertsBanner({ report, stats, settings, onNavigate }) {
  const thresholdText = fmtPercent(settings?.threshold ?? 0, 2);

  let tone = 'ok';
  let title = '监控一切正常';
  let detail = `应披露日 ${report?.expectedDisclosureDate || '—'}，所有产品年化均在阈值 ${thresholdText} 之上。`;

  const alerts = [];
  if (settings?.alertBelowThreshold && stats.underThreshold > 0) {
    alerts.push(
      `${stats.underThreshold} 只产品年化低于阈值 ${thresholdText}`,
    );
  }
  if (settings?.staleReminder && stats.stale > 0) {
    alerts.push(`${stats.stale} 只产品净值未更新到应披露日`);
  }

  if (stats.total === 0) {
    tone = 'info';
    title = '尚未添加监控产品';
    detail = '请在「数据管理」中一键导入插件历史数据，或在「净值管理」中批量录入产品代码。';
  } else if (alerts.length > 0) {
    tone = stats.underThreshold > 0 && settings?.alertBelowThreshold ? 'alert' : 'warn';
    title = '需要关注';
    detail = alerts.join('；');
  }

  const toneClass = {
    alert: 'border-red-200 bg-red-50 text-profit',
    warn: 'border-amber-200 bg-amber-50 text-warn',
    ok: 'border-emerald-200 bg-emerald-50 text-loss',
    info: 'border-brand-200 bg-brand-50 text-brand-700',
  }[tone];

  const dotClass = {
    alert: 'bg-profit',
    warn: 'bg-warn',
    ok: 'bg-loss',
    info: 'bg-brand-500',
  }[tone];

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl2 border px-4 py-3 ${toneClass}`}
      role="status"
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{detail}</p>
      </div>
      {stats.total === 0 ? (
        <button
          type="button"
          onClick={() => onNavigate?.('data')}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-600"
        >
          前往导入
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate?.('nav')}
          className="rounded-lg border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-bold transition hover:bg-white"
        >
          查看净值管理
        </button>
      )}
    </div>
  );
}
