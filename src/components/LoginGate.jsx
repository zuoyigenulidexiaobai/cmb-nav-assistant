import React, { useEffect, useRef, useState } from 'react';
import { usePortfolio } from '../hooks/usePortfolio.js';

/**
 * 登录门：未登录时显示口令输入卡片，已登录后渲染子树。
 * @param {{children: React.ReactNode}} props
 */
export default function LoginGate({ children }) {
  const { ready, authenticated, login, error } = usePortfolio();
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (ready && !authenticated) inputRef.current?.focus();
  }, [ready, authenticated]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!password.trim()) {
      setLocalError('请输入登录口令');
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      await login(password);
    } catch (err) {
      setLocalError(err && err.message ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm font-semibold text-muted">正在连接服务器…</p>
      </div>
    );
  }

  if (authenticated) return children;

  const message = localError || error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-[0_18px_48px_rgba(18,104,244,0.12)]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-lg font-black text-white">
            招
          </span>
          <div className="grid gap-0.5 leading-none">
            <span className="text-lg font-black text-brand-600">招财净值</span>
            <span className="text-[11px] font-semibold text-muted">招行理财净值助手 · 服务器版</span>
          </div>
        </div>

        <label className="mt-6 block text-xs font-bold text-ink" htmlFor="cmb-password">
          登录口令
        </label>
        <input
          id="cmb-password"
          ref={inputRef}
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (localError) setLocalError('');
          }}
          autoComplete="current-password"
          placeholder="请输入访问口令"
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />

        {message ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-profit">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? '登录中…' : '登录'}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          数据保存在服务器数据库，手机与电脑访问同一地址即可共享。首次部署口令见服务端启动日志
          （或环境变量 CMB_NAV_PASSWORD）。
        </p>
      </form>
    </div>
  );
}
