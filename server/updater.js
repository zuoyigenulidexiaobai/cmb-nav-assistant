/**
 * 自更新：从 Git 远端拉取最新代码 → 重新构建前端 → 交由调用方重启进程。
 *
 * 前提：部署目录本身是 Git 仓库（`git clone` 出来的），且当前用户能执行 git 与 node。
 * 若不是 Git 仓库（例如直接拷贝文件部署），本模块只返回「不支持」而不是报错崩掉。
 *
 * 关键安全措施：构建失败会自动把代码回滚到更新前的提交，并恢复旧 dist，
 * 避免出现「代码是新的、dist 是坏的」这种半更新状态。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

/** 远端分支名。 */
const BRANCH = 'main';
/** 单条命令的默认超时（毫秒）。构建较慢，单独放宽。 */
const GIT_TIMEOUT = 90000;
const BUILD_TIMEOUT = 300000;

/** 更新进度状态（进程内单例，重启后归零）。 */
const state = {
  phase: 'idle', // idle | checking | fetching | updating | building | restarting | done | error
  message: '',
  hasUpdate: null,
  current: null,
  latest: null,
  startedAt: null,
  finishedAt: null,
  error: '',
};

/** 重启回调，由 index.js 注册。 */
let restartHandler = null;

/**
 * 注册「构建完成后如何重启」的回调。
 * @param {() => void} handler
 * @returns {void}
 */
export function onRestart(handler) {
  restartHandler = typeof handler === 'function' ? handler : null;
}

/**
 * 读取当前更新状态快照。
 * @returns {typeof state}
 */
export function getUpdateState() {
  return { ...state };
}

/**
 * 执行一条命令并收集输出，不抛异常。
 * @param {string} file 可执行文件
 * @param {string[]} args 参数
 * @param {{ timeout?: number, cwd?: string }} [options]
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
function execCmd(file, args, options = {}) {
  const { timeout = GIT_TIMEOUT, cwd = ROOT_DIR } = options;
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || ''),
          stderr: String(stderr || (error ? error.message : '')),
        });
      },
    );
  });
}

/**
 * 取首行非空文本，用于把命令错误压缩成一句可读提示。
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  const line = String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)[0];
  return line || '未知错误';
}

/**
 * 当前目录是否为 Git 仓库。
 * @returns {boolean}
 */
export function isGitRepo() {
  return fs.existsSync(path.join(ROOT_DIR, '.git'));
}

/**
 * 读取某个引用对应的版本信息。
 * @param {string} ref 例如 HEAD、origin/main
 * @returns {Promise<{hash:string, subject:string, date:string}|null>}
 */
async function readVersion(ref) {
  const hash = await execCmd('git', ['rev-parse', '--short', ref]);
  if (!hash.ok) return null;
  const info = await execCmd('git', ['log', '-1', '--pretty=%s%n%cI', ref]);
  const lines = info.ok ? info.stdout.trim().split('\n') : [];
  return {
    hash: hash.stdout.trim(),
    subject: lines[0] || '',
    date: lines[1] || '',
  };
}

/**
 * 检查是否有新版本。
 *
 * @param {{ fetch?: boolean }} [options] fetch=false 时只对比本地已知的远端引用，不联网
 * @returns {Promise<{gitReady:boolean, ok:boolean, branch?:string,
 *   current?:object|null, latest?:object|null, hasUpdate?:boolean, error?:string}>}
 */
export async function checkForUpdate(options = {}) {
  const { fetch = true } = options;
  if (!isGitRepo()) {
    return { gitReady: false, ok: false, error: '当前部署目录不是 Git 仓库，无法自动更新' };
  }
  if (fetch) {
    const pulled = await execCmd('git', ['fetch', '--depth=1', 'origin', BRANCH]);
    if (!pulled.ok) {
      return { gitReady: true, ok: false, error: `拉取远端失败：${firstLine(pulled.stderr)}` };
    }
  }
  const current = await readVersion('HEAD');
  const latest = await readVersion(`origin/${BRANCH}`);
  if (!current) {
    return { gitReady: true, ok: false, error: '读取当前版本失败' };
  }
  return {
    gitReady: true,
    ok: true,
    branch: BRANCH,
    current,
    latest,
    hasUpdate: Boolean(latest && latest.hash !== current.hash),
  };
}

/**
 * 执行前端构建：优先直接用 node 调 vite，避免依赖 npm 是否在 PATH 里。
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
async function runBuild() {
  const viteBin = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (fs.existsSync(viteBin)) {
    return execCmd(process.execPath, [viteBin, 'build'], { timeout: BUILD_TIMEOUT });
  }
  const npmBin = path.join(
    path.dirname(process.execPath),
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
  );
  return execCmd(npmBin, ['run', 'build'], { timeout: BUILD_TIMEOUT });
}

/**
 * 后台执行更新流程，逐阶段写入 state。
 * @returns {Promise<void>}
 */
async function runUpdate() {
  const startedAt = new Date().toISOString();
  Object.assign(state, {
    phase: 'fetching',
    message: '正在拉取最新代码…',
    startedAt,
    finishedAt: null,
    error: '',
    hasUpdate: null,
  });

  try {
    const check = await checkForUpdate({ fetch: true });
    if (!check.gitReady) throw new Error(check.error || '当前目录不是 Git 仓库');
    if (!check.ok) throw new Error(check.error || '检查更新失败');

    Object.assign(state, { current: check.current, latest: check.latest, hasUpdate: check.hasUpdate });
    if (!check.hasUpdate) {
      Object.assign(state, { phase: 'done', message: '已是最新版本', finishedAt: new Date().toISOString() });
      return;
    }

    const oldHash = check.current.hash;
    state.phase = 'updating';
    state.message = '正在切换到最新版本…';

    const reset = await execCmd('git', ['reset', '--hard', `origin/${BRANCH}`]);
    if (!reset.ok) throw new Error(`切换版本失败：${firstLine(reset.stderr)}`);

    state.phase = 'building';
    state.message = '正在构建前端（约 10~30 秒）…';

    const distDir = path.join(ROOT_DIR, 'dist');
    const backupDir = path.join(ROOT_DIR, `dist.bak.${Date.now()}`);
    const hasDist = fs.existsSync(distDir);
    if (hasDist) await fsp.rename(distDir, backupDir);

    const build = await runBuild();
    if (!build.ok) {
      // 构建失败：回滚代码并恢复旧 dist，保证服务还能用
      await execCmd('git', ['reset', '--hard', oldHash]);
      await fsp.rm(distDir, { recursive: true, force: true });
      if (hasDist) await fsp.rename(backupDir, distDir);
      throw new Error(`构建失败，已回滚到 ${oldHash}：${firstLine(build.stderr || build.stdout)}`);
    }
    if (hasDist) await fsp.rm(backupDir, { recursive: true, force: true });

    Object.assign(state, { phase: 'restarting', message: '构建完成，正在重启服务…' });
    if (restartHandler) {
      restartHandler();
    } else {
      Object.assign(state, { phase: 'done', message: '构建完成，请手动重启服务', finishedAt: new Date().toISOString() });
    }
  } catch (error) {
    Object.assign(state, {
      phase: 'error',
      message: error.message,
      error: error.message,
      finishedAt: new Date().toISOString(),
    });
  }
}

/**
 * 启动一次后台更新（幂等：进行中不会重复启动）。
 * @returns {{started:boolean, state:object}}
 */
export function startUpdate() {
  const busy = ['checking', 'fetching', 'updating', 'building', 'restarting'].includes(state.phase);
  if (busy) return { started: false, state: getUpdateState() };
  runUpdate().catch((error) => {
    Object.assign(state, {
      phase: 'error',
      message: error.message,
      error: error.message,
      finishedAt: new Date().toISOString(),
    });
  });
  return { started: true, state: getUpdateState() };
}
