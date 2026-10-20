/**
 * 招行净值客户端（纯 Node，零 npm 依赖）。
 *
 * 从 Chrome 插件「招行理财净值助手 v0.1.2 / cmb.js」移植：
 *   - SM4/ECB/PKCS7 签名（自实现，SBOX / FK / CK 常量照抄）
 *   - getProductValueByPage / getSAValueByPage 净值接口
 *   - parseNavRow 净值字段解析规则（字段名与插件完全一致）
 *
 * 仅把 fetch 替换为 node:https，其余算法保持逐位一致。
 */

import https from 'node:https';
import { assertCmbConfigured, config } from './config.js';

const { baseUrl: CMB_BASE, appId: CMB_APP_ID, authKey: CMB_AUTH_KEY, businessId: BUSINESS_ID } =
  config.cmb;

/** SM4 S 盒。 */
const SBOX = [
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
];

/** SM4 系统参数 FK。 */
const FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];

/** SM4 固定参数 CK。 */
const CK = [
  0x00070e15, 0x1c232a31, 0x383f464d, 0x545b6269, 0x70777e85, 0x8c939aa1, 0xa8afb6bd, 0xc4cbd2d9,
  0xe0e7eef5, 0xfc030a11, 0x181f262d, 0x343b4249, 0x50575e65, 0x6c737a81, 0x888f969d, 0xa4abb2b9,
  0xc0c7ced5, 0xdce3eaf1, 0xf8ff060d, 0x141b2229, 0x30373e45, 0x4c535a61, 0x686f767d, 0x848b9299,
  0xa0a7aeb5, 0xbcc3cad1, 0xd8dfe6ed, 0xf4fb0209, 0x10171e25, 0x2c333a41, 0x484f565d, 0x646b7279,
];

const textEncoder = new TextEncoder();

/**
 * 32 位左循环移位。
 * @param {number} x
 * @param {number} n
 * @returns {number}
 */
function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/**
 * 从字节数组读取大端 32 位字。
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
function word(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/**
 * 写入大端 32 位字。
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {number} value
 * @returns {void}
 */
function putWord(out, offset, value) {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

/**
 * SM4 非线性变换 τ。
 * @param {number} value
 * @returns {number}
 */
function tau(value) {
  return (
    ((SBOX[(value >>> 24) & 0xff] << 24) |
      (SBOX[(value >>> 16) & 0xff] << 16) |
      (SBOX[(value >>> 8) & 0xff] << 8) |
      SBOX[value & 0xff]) >>>
    0
  );
}

/**
 * 轮函数线性变换 L。
 * @param {number} value
 * @returns {number}
 */
function t(value) {
  const b = tau(value);
  return (b ^ rotl(b, 2) ^ rotl(b, 10) ^ rotl(b, 18) ^ rotl(b, 24)) >>> 0;
}

/**
 * 密钥扩展线性变换 L'。
 * @param {number} value
 * @returns {number}
 */
function tKey(value) {
  const b = tau(value);
  return (b ^ rotl(b, 13) ^ rotl(b, 23)) >>> 0;
}

/**
 * 生成 32 个轮密钥。
 * @param {Uint8Array} keyBytes 16 字节密钥
 * @returns {number[]}
 */
function roundKeys(keyBytes) {
  const k = new Array(36);
  const rk = new Array(32);
  for (let i = 0; i < 4; i += 1) {
    k[i] = (word(keyBytes, i * 4) ^ FK[i]) >>> 0;
  }
  for (let i = 0; i < 32; i += 1) {
    k[i + 4] = (k[i] ^ tKey((k[i + 1] ^ k[i + 2] ^ k[i + 3] ^ CK[i]) >>> 0)) >>> 0;
    rk[i] = k[i + 4];
  }
  return rk;
}

/**
 * 加密单个 16 字节分组。
 * @param {Uint8Array} block
 * @param {number[]} rk
 * @returns {Uint8Array}
 */
function encryptBlock(block, rk) {
  const x = new Array(36);
  for (let i = 0; i < 4; i += 1) x[i] = word(block, i * 4);
  for (let i = 0; i < 32; i += 1) {
    x[i + 4] = (x[i] ^ t((x[i + 1] ^ x[i + 2] ^ x[i + 3] ^ rk[i]) >>> 0)) >>> 0;
  }
  const out = new Uint8Array(16);
  putWord(out, 0, x[35]);
  putWord(out, 4, x[34]);
  putWord(out, 8, x[33]);
  putWord(out, 12, x[32]);
  return out;
}

/**
 * PKCS7 填充。
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function pkcs7Pad(bytes) {
  const pad = 16 - (bytes.length % 16 || 16);
  const actualPad = pad === 0 ? 16 : pad;
  const out = new Uint8Array(bytes.length + actualPad);
  out.set(bytes);
  out.fill(actualPad, bytes.length);
  return out;
}

/**
 * base64 编码（Node Buffer，等价于插件的 btoa）。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/**
 * SM4/ECB/PKCS7 加密并输出 base64。
 * @param {string} plaintext
 * @param {string} key
 * @returns {string}
 */
export function sm4EcbEncryptBase64(plaintext, key) {
  const data = pkcs7Pad(textEncoder.encode(plaintext));
  const rk = roundKeys(textEncoder.encode(key));
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) {
    out.set(encryptBlock(data.subarray(i, i + 16), rk), i);
  }
  return base64(out);
}

/**
 * 构造带签名的请求头。
 *
 * 数据源参数（appId / authKey / businessId / baseUrl）来自环境变量，
 * 仓库内不保留明文；缺失时抛错，由调用方转成可读的失败原因。
 * @returns {Record<string,string>}
 */
export function signatureHeaders() {
  assertCmbConfigured();
  const timespan = String(Date.now());
  const signature = sm4EcbEncryptBase64(`${CMB_APP_ID}|${timespan}`, CMB_AUTH_KEY);
  return {
    'Content-Type': 'application/json',
    'X-B3-BusinessId': BUSINESS_ID,
    appId: CMB_APP_ID,
    timespan,
    signature,
  };
}

/**
 * 使用 node:https 发起 POST（带 15s 超时）。
 * @param {string} pathname 形如 `/ProductValue/getProductValueByPage`
 * @param {object|null} body
 * @returns {Promise<object>} 解析后的 JSON
 */
function cmbPost(pathname, body = null) {
  return new Promise((resolve, reject) => {
    assertCmbConfigured();
    const url = new URL(`${CMB_BASE}${pathname}`);
    const payload = body ? JSON.stringify(body) : undefined;
    const headers = signatureHeaders();
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers,
        timeout: config.cmb.timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`招商银行接口请求失败：HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('招商银行接口返回了非 JSON 内容'));
          }
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error('招商银行接口请求超时')));
    req.on('error', (error) => reject(error));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 校验招行接口 returnCode。
 * @param {object} payload
 * @returns {object}
 */
function assertReturnCode(payload) {
  if (payload && payload.returnCode && payload.returnCode !== 'SUC0000') {
    throw new Error(`招商银行接口返回异常：${payload.errorMsg || payload.returnCode}`);
  }
  return payload;
}

/**
 * 解析 YYYYMMDD 日期为 Date。
 * @param {unknown} value
 * @returns {Date|null}
 */
function parseCmbDate(value) {
  const text = String(value || '');
  if (!/^\d{8}$/.test(text)) return null;
  return new Date(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)));
}

/**
 * Date → 'YYYY-MM-DD'。
 * @param {Date} date
 * @returns {string}
 */
function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 按插件规则解析单条净值行。
 * @param {object} row
 * @param {string} source 数据来源标识
 * @param {boolean} isSa 是否为 SA（结构性）产品
 * @returns {{code:string,name:string,date:string,nav:number,source:string,sourceField:string}|null}
 */
function parseNavRow(row, source, isSa) {
  try {
    let rawDate;
    let sourceField;
    let nav;
    let name;
    let code;
    if (isSa) {
      rawDate = row.znavDat;
      sourceField =
        row.znavCtl !== '' && row.znavCtl != null && row.znavCtl !== '0' ? 'znavCtl' : 'znavVal';
      nav = Number(row[sourceField]);
      name = row.zripSnm || row.prdName || '';
      code = row.zripNbr || row.zripInn || row.prdCode || '';
    } else {
      rawDate = row.valueDate || row.znavDat;
      sourceField =
        row.znavSum !== '' && row.znavSum != null && row.znavSum !== '0' ? 'znavSum' : 'netValue';
      nav = Number(row[sourceField]);
      name = row.prdName || row.zripSnm || '';
      code = row.prdCode || row.zripNbr || '';
    }
    const date = parseCmbDate(rawDate);
    if (!date || !Number.isFinite(nav) || nav <= 0) return null;
    return { code: String(code), name: String(name), date: isoDate(date), nav, source, sourceField };
  } catch {
    return null;
  }
}

/**
 * 按产品代码查询产品详情（可能返回 null）。
 * @param {string} code
 * @returns {Promise<object|null>}
 */
async function getProductByCode(code) {
  const response = assertReturnCode(
    await cmbPost(`/ProductInfo/getProductByPrdCode?prdCode=${encodeURIComponent(code)}`),
  );
  if (Array.isArray(response.body) && response.body.length) return response.body[0];

  const search = assertReturnCode(
    await cmbPost('/ProductInfo/getProductByFilterByPage', {
      saleStatus: '',
      prdType: '',
      terms: '',
      riskType: '',
      areaCode: '',
      orderBy: '',
      keyWord: code,
      pageIndex: 1,
      pageSize: 20,
    }),
  );
  const rows = search && search.body && Array.isArray(search.body.data) ? search.body.data : [];
  return rows[0] || null;
}

/**
 * 拉取普通产品净值行。
 * @param {string} code
 * @param {number} pageSize
 * @returns {Promise<{source:string, rows:Array<object>}>}
 */
async function getOrdinaryValues(code, pageSize) {
  const response = assertReturnCode(
    await cmbPost('/ProductValue/getProductValueByPage', {
      prdCode: code,
      startDate: '',
      endDate: '',
      pageIndex: 1,
      pageSize,
    }),
  );
  return {
    source: 'ProductValueByPage',
    rows: response && response.body && Array.isArray(response.body.data) ? response.body.data : [],
  };
}

/**
 * 拉取 SA（结构性）产品净值行。
 * @param {object} product
 * @param {number} pageSize
 * @returns {Promise<{source:string, rows:Array<object>}>}
 */
async function getSaValues(product, pageSize) {
  const saaCod = product.saaCod || product.zsaaCod;
  const funCod = product.funCod || product.prdCode || product.zripNbr;
  if (!saaCod || !funCod) return { source: 'SAValueByPage', rows: [] };
  const response = assertReturnCode(
    await cmbPost('/ProductValue/getSAValueByPage', {
      saaCod,
      funCod,
      pageIndex: 1,
      pageSize,
    }),
  );
  return {
    source: 'SAValueByPage',
    rows: response && response.body && Array.isArray(response.body.data) ? response.body.data : [],
  };
}

/**
 * 抓取单个产品的近期净值点。
 *
 * @param {string} code 产品代码
 * @param {{days?:number, pageSize?:number}} [options]
 * @returns {Promise<{points:Array<{date:string,nav:number}>, source:string, name:string}>}
 */
export async function fetchNavPoints(code, options = {}) {
  const days = Number(options.days) > 0 ? Number(options.days) : config.defaultLookbackDays;
  const pageSize = Number(options.pageSize) > 0 ? Number(options.pageSize) : 100;

  let product = null;
  let isSa = false;
  let sourceRows;
  let productName = '';

  product = await getProductByCode(code);
  if (product) {
    productName = String(product.prdName || product.prdBrief || '').trim();
    isSa = String(product.isSA) === '1';
    sourceRows = isSa ? await getSaValues(product, pageSize) : await getOrdinaryValues(code, pageSize);
    if (!isSa && sourceRows.rows.length === 0) {
      sourceRows = await getSaValues(product, pageSize);
      isSa = sourceRows.rows.length > 0;
    }
  } else {
    sourceRows = await getOrdinaryValues(code, pageSize);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = isoDate(cutoff);

  const map = new Map();
  for (const row of sourceRows.rows) {
    const parsed = parseNavRow(row, sourceRows.source, isSa);
    if (!parsed) continue;
    if (parsed.date < cutoffIso) continue;
    // 同日期后者覆盖前者；再按日期升序输出。
    map.set(parsed.date, { date: parsed.date, nav: parsed.nav });
  }
  const points = Array.from(map.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return { points, source: sourceRows.source, name: productName };
}

/**
 * 按产品代码查询招行产品名称。
 *
 * 与抓取共用同一套查询逻辑（getProductByCode），因此名称口径与插件一致：
 * `prdName` 优先，缺失时回落 `prdBrief`。查不到产品时返回空串。
 *
 * @param {string} code 产品代码
 * @returns {Promise<{code:string, name:string}>}
 */
export async function fetchProductName(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { code: '', name: '' };
  const product = await getProductByCode(normalized);
  const name = product ? String(product.prdName || product.prdBrief || '').trim() : '';
  return { code: normalized, name };
}
