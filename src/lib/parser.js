/**
 * 输入解析工具（纯函数）
 *
 * - parseProductCodes：批量粘贴产品代码
 * - parseNavText：批量粘贴「日期 净值」
 * - parseDateToken：多格式日期解析
 *
 * 解析失败时逐行返回错误，绝不整体失败。
 */

/**
 * 批量解析产品代码。
 * 按 `[,\uFF0C\n\r\t;；\s]+` 切分 → 去空格 → 转大写 → 过滤空串。
 * @param {string} value
 * @returns {string[]}
 */
export function parseProductCodes(value) {
  return String(value ?? '')
    .split(/[,\uFF0C\n\r\t;；\s]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * 解析单个日期 token，支持 `YYYY-MM-DD`、`YYYY/MM/DD`、`YYYYMMDD`。
 * @param {string} token
 * @returns {string|null} 规范化后的 YYYY-MM-DD；非法返回 null
 */
export function parseDateToken(token) {
  const text = String(token ?? '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 解析单个净值 token：接受小数（正数）。
 * @param {string} token
 * @returns {number|null}
 */
export function parseNavToken(token) {
  const text = String(token ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * 批量粘贴净值文本。
 *
 * 每行一条，分隔符支持 `<tab>`、`,`、`，`、空格；
 * 兼容三种写法：「日期 净值」、「代码 日期 净值」。
 * 解析失败的行会在 errors 中逐行报告，不影响其他行。
 *
 * @param {string} text
 * @returns {{points: Array<{date:string, nav:number}>, errors: Array<{line:number, text:string, reason:string}>}}
 */
export function parseNavText(text) {
  /** @type {Array<{date:string, nav:number}>} */
  const points = [];
  /** @type {Array<{line:number, text:string, reason:string}>} */
  const errors = [];

  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    const tokens = line.split(/[\s,，;；]+/).filter(Boolean);
    if (tokens.length < 2) {
      errors.push({
        line: index + 1,
        text: raw,
        reason: '缺少净值，格式应为「日期 净值」',
      });
      return;
    }

    const dateIndex = tokens.findIndex((token) => parseDateToken(token) !== null);
    if (dateIndex === -1) {
      errors.push({
        line: index + 1,
        text: raw,
        reason: `无法识别的日期：${tokens[0]}`,
      });
      return;
    }
    const date = /** @type {string} */ (parseDateToken(tokens[dateIndex]));

    let nav = null;
    for (let i = dateIndex + 1; i < tokens.length; i += 1) {
      const value = parseNavToken(tokens[i]);
      if (value !== null) {
        nav = value;
        break;
      }
    }
    if (nav === null) {
      errors.push({
        line: index + 1,
        text: raw,
        reason: '无法识别的净值，请填写大于 0 的数字',
      });
      return;
    }

    points.push({ date, nav });
  });

  return { points, errors };
}

/**
 * 解析持仓输入（份额 / 成本净值）。
 * @param {{shares: string|number, costNav: string|number}} input
 * @returns {{ok: true, value: {shares:number, costNav:number}|null} | {ok: false, error: string}}
 */
export function parseHoldingInput(input) {
  const sharesText = String(input?.shares ?? '').trim();
  const costText = String(input?.costNav ?? '').trim();

  if (!sharesText && !costText) return { ok: true, value: null };

  const shares = Number(sharesText);
  if (!Number.isFinite(shares) || shares < 0) {
    return { ok: false, error: '持有份额需为不小于 0 的数字' };
  }
  const costNav = Number(costText);
  if (!Number.isFinite(costNav) || costNav <= 0) {
    return { ok: false, error: '成本净值需为大于 0 的数字' };
  }
  return { ok: true, value: { shares, costNav } };
}
