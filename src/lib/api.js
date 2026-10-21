/**
 * 后端 API 客户端。
 *
 * 所有请求同源（相对路径 `/api/*`）并携带 Cookie（credentials: 'include'）。
 * - 401 → 抛出可识别的 AuthError（供上层展示登录门）。
 * - 其他失败 → 抛出带后端中文文案的普通 Error。
 */

/** 认证失败错误（会话过期 / 未登录）。 */
export class AuthError extends Error {
  /**
   * @param {string} [message]
   */
  constructor(message) {
    super(message || '未登录或会话已过期');
    this.name = 'AuthError';
    /** 便于 `instanceof` 失效时判断。 */
    this.authError = true;
  }
}

const BASE = '/api';

/**
 * 统一请求封装。
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<any>} 后端 data 字段
 */
async function request(method, path, body) {
  const options = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch {
    throw new Error('无法连接服务器，请检查网络或稍后重试');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    throw new AuthError(payload && payload.error ? payload.error : '未登录或会话已过期');
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(
      (payload && payload.error) || `请求失败（HTTP ${response.status}）`,
    );
  }
  return payload.data;
}

/** 后端 API 集合。 */
export const api = {
  /** 健康检查。 */
  health: () => request('GET', '/health'),
  /** 查询当前会话是否已登录。 */
  me: () => request('GET', '/auth/me'),
  /** 登录。口令错误时抛出 AuthError。 */
  login: (password) => request('POST', '/auth/login', { password }),
  /** 退出登录。 */
  logout: () => request('POST', '/auth/logout'),
  /** 拉取全量状态。 */
  getState: () => request('GET', '/state'),
  /** 批量新增产品。 */
  addProducts: (codes) => request('POST', '/products', { codes }),
  /** 更新产品元信息。 */
  patchProduct: (code, patch) => request('PATCH', `/products/${encodeURIComponent(code)}`, patch),
  /** 删除产品（连同净值与持仓）。 */
  deleteProduct: (code) => request('DELETE', `/products/${encodeURIComponent(code)}`),
  /** 保存净值点（默认手动来源）。 */
  saveNav: (code, points, source = 'manual') =>
    request('POST', `/products/${encodeURIComponent(code)}/nav`, { points, source }),
  /** 删除净值点；dates 为空则清空该产品全部净值。 */
  deleteNav: (code, dates) =>
    request('DELETE', `/products/${encodeURIComponent(code)}/nav`, dates ? { dates } : {}),
  /** 保存 / 清除持仓。 */
  saveHolding: (code, holding) =>
    request('PUT', `/holdings/${encodeURIComponent(code)}`, holding || {}),
  /** 更新设置（部分）。 */
  saveSettings: (patch) => request('PUT', '/settings', patch),
  /** 触发同步抓取。 */
  sync: (codes) => request('POST', '/sync', codes ? { codes } : {}),
  /** 查询同步日志与状态。 */
  syncLog: () => request('GET', '/sync/log'),
  /**
   * 从招行同步产品名称。
   * @param {string[]|undefined} codes 指定产品；省略表示全部产品（含已归档）
   * @param {boolean} [overwrite] 是否以招行名称为准覆盖本地（默认 true）
   */
  syncNames: (codes, overwrite = true) =>
    request('POST', '/sync/names', {
      ...(Array.isArray(codes) && codes.length ? { codes } : {}),
      overwrite,
    }),
  /** 一次性导入插件种子数据。 */
  importSeed: (seed) => request('POST', '/import', seed),
  /**
   * 查询版本信息。
   * @param {boolean} [check] 是否联网检查远端（false 时只读本地已知版本）
   */
  getVersion: (check = false) => request('GET', `/system/version${check ? '?check=1' : ''}`),
  /** 查询自更新进度。 */
  updateStatus: () => request('GET', '/system/update'),
  /** 启动自更新（后台执行，返回即表示已开始）。 */
  startUpdate: () => request('POST', '/system/update'),
};
