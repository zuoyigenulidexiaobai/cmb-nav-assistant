import React from 'react';
import { usePortfolio } from '../hooks/usePortfolio.js';
import { fmtDateTime } from '../lib/format.js';

/**
 * 应用导航项定义。App 与 Layout 共用。
 */
export const NAV_ITEMS = [
  { key: 'dashboard', label: '概览', hint: '监控总览' },
  { key: 'nav', label: '净值管理', hint: '录入与维护' },
  { key: 'trend', label: '净值走势', hint: '多产品对比' },
  { key: 'holdings', label: '持仓收益', hint: '份额与收益' },
  { key: 'data', label: '数据管理', hint: '导入导出' },
];

/**
 * 品牌标识。
 * @param {{compact?: boolean}} props
 */
function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-lg font-black text-white shadow-[0_8px_18px_rgba(18,104,244,0.28)]"
        aria-hidden="true"
      >
        招
      </span>
      <span className="grid gap-0.5 leading-none">
        <span className="text-lg font-black text-brand-600">招财净值</span>
        <span className="text-[11px] font-semibold text-muted">招行理财净值助手</span>
      </span>
      {!compact && (
        <span className="ml-auto rounded-full bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-600">
          服务器
        </span>
      )}
    </div>
  );
}

/**
 * 侧边导航按钮。
 * @param {{item: object, active: boolean, badge?: number, onClick: Function}} props
 */
function SideNavButton({ item, active, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition',
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-slate-600 hover:bg-slate-50 hover:text-ink',
      ].join(' ')}
    >
      <span className="grid gap-0.5">
        <span className="text-sm font-bold">{item.label}</span>
        <span className="text-[11px] text-faint">{item.hint}</span>
      </span>
      {typeof badge === 'number' && badge > 0 ? (
        <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * 应用外壳：桌面侧边栏 + 移动端顶部导航。
 * @param {{view:string, onNavigate:Function, badges?:object, children:React.ReactNode}} props
 */
export default function Layout({ view, onNavigate, badges = {}, children }) {
  const { serverSync, logout } = usePortfolio();
  const lastRun = serverSync?.lastRun || null;

  const renderNav = (variant) =>
    NAV_ITEMS.map((item) =>
      variant === 'side' ? (
        <SideNavButton
          key={item.key}
          item={item}
          active={view === item.key}
          badge={badges[item.key]}
          onClick={() => onNavigate(item.key)}
        />
      ) : (
        <button
          key={item.key}
          type="button"
          onClick={() => onNavigate(item.key)}
          className={[
            'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition',
            view === item.key
              ? 'bg-brand-500 text-white'
              : 'bg-slate-100 text-slate-600',
          ].join(' ')}
        >
          {item.label}
          {typeof badges[item.key] === 'number' && badges[item.key] > 0 ? (
            <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold">
              {badges[item.key]}
            </span>
          ) : null}
        </button>
      ),
    );

  return (
    <div className="min-h-full md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white/70 px-4 py-6 backdrop-blur md:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-1">{renderNav('side')}</nav>
        <div className="mt-6 grid gap-2">
          <p className="text-[11px] leading-relaxed text-faint">
            上次更新：
            <br />
            <span className="font-semibold text-muted">
              {lastRun ? fmtDateTime(String(lastRun.startedAt || '').slice(0, 19)) : '尚未同步'}
            </span>
          </p>
          <p className="text-[11px] leading-relaxed text-faint">
            数据保存在服务器 SQLite · 多设备共享 · 内置算法与插件一致
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            退出登录
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur md:hidden">
          <div className="px-4 py-3">
            <Brand />
          </div>
          <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2.5">{renderNav('top')}</nav>
          <p className="px-4 pb-2 text-[11px] text-faint">
            上次更新：
            <span className="font-semibold text-muted">
              {lastRun ? fmtDateTime(String(lastRun.startedAt || '').slice(0, 19)) : '尚未同步'}
            </span>
          </p>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 md:px-8 md:py-8">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-[1200px] px-4 pb-6 text-[11px] text-faint md:px-8">
          招行理财净值助手（服务器版）· 净值由服务器定时抓取或用户手动录入，仅供个人参考，不构成投资建议。
        </footer>
      </div>
    </div>
  );
}
