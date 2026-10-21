/**
 * 版本与更新卡片：查看当前提交、检查远端是否有新版本、一键拉取并重启。
 *
 * 前提是部署目录为 Git 仓库；否则只展示「不支持」，不提供按钮。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/** 简单等待。 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 进行中的阶段集合。 */
const BUSY_PHASES = ['checking', 'fetching', 'updating', 'building', 'restarting'];

/** 阶段对应的展示文案。 */
const PHASE_LABELS = {
  idle: '',
  checking: '正在检查…',
  fetching: '正在拉取最新代码…',
  updating: '正在切换版本…',
  building: '正在构建前端…',
  restarting: '正在重启服务…',
  done: '已完成',
  error: '更新失败',
};

/**
 * 数据管理页的「版本与更新」卡片。
 * @param {{notify?: Function}} props
 */
export default function VersionCard({ notify }) {
  const [version, setVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [update, setUpdate] = useState(null);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  /** 读取版本信息；check=true 时联网拉取远端。 */
  const load = useCallback(async (check) => {
    setError('');
    setChecking(true);
    try {
      const data = await api.getVersion(check);
      setVersion(data);
      if (check) {
        if (!data.gitReady) {
          setError('当前部署目录不是 Git 仓库，无法一键更新');
        } else if (!data.ok) {
          setError(data.error || '检查更新失败');
        } else if (!data.hasUpdate) {
          notify?.('已经是最新版本', 'info');
        }
      }
    } catch (err) {
      setError(err.message || '检查更新失败');
    } finally {
      setChecking(false);
    }
  }, [notify]);

  useEffect(() => {
    load(false);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  /** 服务重启完成后自动刷新页面。 */
  const waitForRestart = useCallback(async () => {
    for (let i = 0; i < 80; i += 1) {
      await sleep(1500);
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) {
          window.location.reload();
          return;
        }
      } catch {
        /* 服务还没起来，继续等 */
      }
    }
    setUpdating(false);
    setError('服务重启超时，请手动刷新页面');
  }, []);

  /** 轮询更新进度。 */
  const poll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.updateStatus();
        setUpdate(data.update);
        const phase = data.update?.phase;
        if (phase === 'restarting') {
          clearInterval(timerRef.current);
          timerRef.current = null;
          waitForRestart();
          return;
        }
        if (phase === 'error' || phase === 'done') {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setUpdating(false);
          if (phase === 'error') {
            setError(data.update.message || '更新失败');
            notify?.(data.update.message || '更新失败', 'error');
          } else {
            notify?.('已经是最新版本', 'info');
            load(false);
          }
        }
      } catch {
        /* 重启期间请求会失败，忽略即可 */
      }
    }, 1200);
  }, [load, notify, waitForRestart]);

  /** 触发一键更新。 */
  const handleUpdate = useCallback(async () => {
    setError('');
    setUpdating(true);
    try {
      const data = await api.startUpdate();
      setUpdate(data.update);
      if (!data.started) {
        setUpdating(false);
        setError('已有更新任务在进行中');
        return;
      }
      notify?.('已开始更新，构建期间请勿关闭页面', 'info');
      poll();
    } catch (err) {
      setUpdating(false);
      setError(err.message || '启动更新失败');
    }
  }, [notify, poll]);

  const busy = updating || (update && BUSY_PHASES.includes(update.phase));
  const current = version?.current || null;
  const hasUpdate = Boolean(version?.hasUpdate);
  const gitReady = version ? version.gitReady !== false : true;

  /** 状态行文案。 */
  const statusText = useMemo(() => {
    if (busy) return PHASE_LABELS[update?.phase] || '正在更新…';
    if (!version) return '读取中…';
    if (!version.gitReady) return '当前目录不是 Git 仓库，无法一键更新';
    if (version.ok === false) return version.error || '无法连接代码仓库';
    if (hasUpdate) return `发现新版本 ${version.latest?.hash || ''}`;
    return '已是最新版本';
  }, [busy, hasUpdate, update, version]);

  return (
    <div className="card p-4">
      <h2 className="text-sm font-black text-ink">版本与更新</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        从代码仓库拉取最新版本并自动重新构建，完成后服务会短暂重启（约 10 秒）。
      </p>

      <div className="mt-3 rounded-xl border border-line bg-slate-50/70 p-3 text-xs text-muted">
        <p>
          当前版本：
          <strong className="text-ink">{current ? current.hash : '—'}</strong>
          {current?.subject ? <span className="text-faint"> · {current.subject}</span> : null}
        </p>
        <p className="mt-1">
          状态：<strong className="text-ink">{statusText}</strong>
        </p>
        {hasUpdate && version?.latest ? (
          <p className="mt-1 break-words text-[11px] text-faint">
            最新：{version.latest.hash} · {version.latest.subject}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => load(true)}
          disabled={checking || Boolean(busy) || !gitReady}
          className="rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={Boolean(busy) || !gitReady || !hasUpdate}
          className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? PHASE_LABELS[update?.phase] || '更新中…' : '立即更新并重启'}
        </button>
      </div>

      {busy ? (
        <div className="mt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-500" />
          </div>
          <p className="mt-2 text-[11px] text-muted">{update?.message || '正在更新，请稍候…'}</p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 break-words rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
