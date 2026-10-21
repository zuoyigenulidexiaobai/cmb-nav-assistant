/**
 * 运行期配置与环境变量解析。
 *
 * 所有路径都以项目根目录（server/ 的上一级）为基准解析，允许通过环境变量覆盖，
 * 便于服务器上把数据库放到独立磁盘或备份目录。
 *
 * 环境变量：
 *   PORT             监听端口，默认 9001
 *   HOST             监听地址，默认 0.0.0.0（前有 nginx 时应设为 127.0.0.1）
 *   TRUST_PROXY      置 1 时信任反向代理写入的客户端 IP 头（前有 nginx 时须开启）
 *   PROXY_IP_HEADER  反代传递真实客户端 IP 的请求头名，默认 x-real-ip
 *   DATA_DIR         运行时数据目录（SQLite 库 + auth.json），默认 <root>/data
 *   DIST_DIR         前端构建产物目录，默认 <root>/dist
 *   CMB_NAV_PASSWORD 首次启动时的初始登录口令；未设置则随机生成并打印
 *   CMB_NAV_TZ       定时任务时区标识，默认 Asia/Shanghai（仅用于展示与日志）
 *   CMB_NAV_SCHEDULE_HOUR    定时抓取小时（Asia/Shanghai 24 小时制）的初始默认值，默认 9
 *   CMB_NAV_SCHEDULE_MINUTE  定时抓取分钟的初始默认值，默认 0
 *                   —— 抓取时刻可在页面「数据管理 → 净值自动同步」中修改并即时生效，
 *                      页面保存过的值优先于这里的默认值。
 *   CMB_NAV_RETRY_DELAY_MS   定时/补抓失败后的自动重试延迟列表（毫秒，逗号分隔），默认 300000,600000
 *
 * 数据源参数（无默认值，必须由环境变量提供，见 .env.example）：
 *   CMB_NAV_API_BASE     净值接口基地址
 *   CMB_NAV_APP_ID       接口 appId
 *   CMB_NAV_AUTH_KEY     接口签名密钥
 *   CMB_NAV_BUSINESS_ID  接口业务标识
 *
 * 环境变量取值顺序：真实进程环境 > 项目根目录下的 .env 文件 > 代码内默认值。
 * .env 只做最简解析（KEY=VALUE，忽略 # 注释与空行），不覆盖已存在的进程环境变量。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 当前模块目录。 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（server/ 的上一级）。 */
export const ROOT_DIR = path.resolve(currentDir, '..');

/**
 * 载入项目根目录下的 .env（若存在）。
 *
 * 只支持 `KEY=VALUE` 单行形式，值两侧的成对引号会被去掉；
 * 已存在于 process.env 的键不会被覆盖，因此 systemd / docker 注入的变量优先级更高。
 * @returns {string[]} 实际写入的键名（用于启动日志，不含值）
 */
export function loadDotEnv() {
  const file = path.join(ROOT_DIR, '.env');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const loaded = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

loadDotEnv();

/**
 * 解析一个可被环境变量覆盖的绝对路径。
 * @param {string|undefined} value 环境变量值
 * @param {string} fallback 默认相对项目根的路径
 * @returns {string} 绝对路径
 */
function resolveDir(value, fallback) {
  if (value && String(value).trim()) return path.resolve(String(value).trim());
  return path.resolve(ROOT_DIR, fallback);
}

/**
 * 读取整型环境变量（带范围约束）。
 * @param {string} name 环境变量名
 * @param {number} fallback 默认值
 * @param {number} min 最小值（含）
 * @param {number} max 最大值（含）
 * @returns {number} 解析结果；缺失或越界时返回默认值
 */
function readIntEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

/**
 * 读取逗号分隔的毫秒列表环境变量。
 * @param {string} name 环境变量名
 * @param {number[]} fallback 默认列表
 * @returns {number[]} 解析结果；缺失或全部非法时返回默认列表的副本
 */
function readMsListEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback.slice();
  const list = String(raw)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return list.length ? list : fallback.slice();
}

/** 归一化后的运行期配置对象。 */
export const config = {
  /** 服务版本号，写入 /api/health。 */
  version: '1.0.0',
  /** HTTP 监听端口。 */
  port: Number(process.env.PORT) || 9001,
  /** HTTP 监听地址。 */
  host: process.env.HOST || '0.0.0.0',
  /**
   * 是否信任反向代理写入的客户端 IP 头。
   *
   * 前面挂 nginx 时必须开启，否则所有请求的来源地址都会是反代自身（127.0.0.1），
   * 登录节流会退化成「一个 IP」的全局锁。
   *
   * 只有在反代由自己控制、并且会覆写该请求头（如 nginx 的
   * `proxy_set_header X-Real-IP $remote_addr`）时才可开启；
   * 否则客户端可以直接伪造 IP 绕过节流。
   */
  trustProxy: process.env.TRUST_PROXY === '1',
  /** 反向代理写入真实客户端 IP 的请求头名（小写）。 */
  proxyIpHeader: (process.env.PROXY_IP_HEADER || 'x-real-ip').toLowerCase(),
  /** 运行时数据目录（SQLite + auth.json）。 */
  dataDir: resolveDir(process.env.DATA_DIR, 'data'),
  /** 前端构建产物目录。 */
  distDir: resolveDir(process.env.DIST_DIR, 'dist'),
  /** 日志/展示用时区标识（Asia/Shanghai = UTC+8，无夏令时）。 */
  timezone: process.env.CMB_NAV_TZ || 'Asia/Shanghai',
  /** 会话有效期：30 天（毫秒）。 */
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  /** 请求体大小上限：1MB。 */
  maxBodyBytes: 1024 * 1024,
  /**
   * 定时抓取时刻的**初始默认值**（Asia/Shanghai 24 小时制，默认 09:00）。
   *
   * 实际生效时刻以数据库 settings 表为准（页面可改、即时生效）；
   * 这里的值只在用户从未在页面上改过时作为兜底。
   */
  schedule: {
    hour: readIntEnv('CMB_NAV_SCHEDULE_HOUR', 9, 0, 23),
    minute: readIntEnv('CMB_NAV_SCHEDULE_MINUTE', 0, 0, 59),
  },
  /** 定时/补抓失败后的自动重试延迟列表（毫秒，逗号分隔，默认 5 分钟、10 分钟）。 */
  retryDelaysMs: readMsListEnv('CMB_NAV_RETRY_DELAY_MS', [300000, 600000]),
  /** 抓取时默认回看的自然日天数。 */
  defaultLookbackDays: 90,
  /** 招行接口相关常量。凭据一律来自环境变量，仓库内不留明文。 */
  cmb: {
    baseUrl: (process.env.CMB_NAV_API_BASE || '').trim(),
    appId: (process.env.CMB_NAV_APP_ID || '').trim(),
    authKey: (process.env.CMB_NAV_AUTH_KEY || '').trim(),
    businessId: (process.env.CMB_NAV_BUSINESS_ID || '').trim(),
    timeoutMs: 15000,
    /** 每个产品之间的间隔，避免触发风控。 */
    requestGapMs: 400,
    /** 单产品失败后的重试退避（毫秒）。 */
    retryBackoffMs: [1000, 3000],
  },
};

/** 缺少的数据源环境变量名（为空数组表示配置齐全）。 */
export const missingCmbEnv = Object.entries({
  CMB_NAV_API_BASE: config.cmb.baseUrl,
  CMB_NAV_APP_ID: config.cmb.appId,
  CMB_NAV_AUTH_KEY: config.cmb.authKey,
  CMB_NAV_BUSINESS_ID: config.cmb.businessId,
})
  .filter(([, value]) => !value)
  .map(([key]) => key);

/**
 * 断言数据源环境变量已配置；缺失时抛出带指引的错误。
 *
 * 只在真正要访问接口时调用（抓取、产品名同步），
 * 纯本地功能（录入、查看、统计）不因缺少凭据而不可用。
 * @returns {void}
 */
export function assertCmbConfigured() {
  if (!missingCmbEnv.length) return;
  throw new Error(
    `缺少环境变量 ${missingCmbEnv.join('、')}。请复制 .env.example 为 .env 并填入数据源参数后重启服务。`,
  );
}
