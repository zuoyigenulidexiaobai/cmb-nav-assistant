import React from 'react';
import { usePortfolio } from '../hooks/usePortfolio.js';
import AlertsBanner from '../components/AlertsBanner.jsx';
import SummaryCards from '../components/SummaryCards.jsx';
import { EmptyState, PageHeader, RateCell, StatusPills } from '../components/common.jsx';
import { PERIODS } from '../lib/netvalue.js';
import { fmtDate, fmtNav } from '../lib/format.js';

/**
 * 概览仪表盘：警示条 + 指标卡 + 产品收益卡片网格。
 * @param {{onNavigate: Function, notify: Function}} props
 */
export default function Dashboard({ onNavigate, notify }) {
  const { report, stats, settings, importSeed, seedSummary } = usePortfolio();
  const products = report.products;

  const handleSeedImport = async () => {
    const summary = await importSeed();
    if (summary.error) {
      notify?.(`导入失败：${summary.error}`, 'error');
      return;
    }
    notify?.(`已导入插件历史数据：${summary.products} 只产品 / ${summary.navPoints} 个净值点`, 'success');
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Dashboard"
        title="监控概览"
        description={`基于手动录入的净值历史，按近 1 / 2 / 4 周年化收益率对比阈值 ${(settings.threshold * 100).toFixed(2)}%。应披露日 ${report.expectedDisclosureDate || '—'}。`}
      />

      <AlertsBanner
        report={report}
        stats={stats}
        settings={settings}
        onNavigate={onNavigate}
      />

      <SummaryCards stats={stats} report={report} />

      {products.length === 0 ? (
        <EmptyState
          title="还没有监控中的产品"
          description={`可一键导入插件导出的历史数据（${seedSummary.productCount} 只产品 / ${seedSummary.navPoints} 个净值点），或前往「净值管理」手动录入产品代码。`}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={handleSeedImport}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
              >
                导入插件历史数据
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('nav')}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:border-brand-300 hover:text-brand-600"
              >
                前往净值管理
              </button>
            </div>
          }
        />
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {products.map((item) => (
            <article
              key={item.code}
              className={`card p-4 ${
                item.underThreshold && settings.alertBelowThreshold
                  ? 'ring-1 ring-red-200'
                  : item.stale && settings.staleReminder
                    ? 'ring-1 ring-amber-200'
                    : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-ink">{item.code}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">
                    {item.name || '未命名产品'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-black leading-none text-ink">
                    {fmtNav(item.latestNav)}
                  </p>
                  <p className="mt-1 text-[11px] text-faint">{fmtDate(item.latestDate)}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50/70 p-2.5">
                {PERIODS.map((period) => (
                  <div key={period.key} className="min-w-0">
                    <RateCell label={period.label} period={item.periods?.[period.key]} />
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-start justify-between gap-2">
                <StatusPills result={item} />
                <p className="max-w-[60%] text-right text-[11px] leading-snug text-faint">
                  {item.messages?.length ? item.messages.join('；') : '正常'}
                </p>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
