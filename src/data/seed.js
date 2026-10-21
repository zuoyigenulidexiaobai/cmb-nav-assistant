/**
 * 种子数据：首次打开时预填进本地存储的产品与历史净值。
 *
 * 该文件位于项目根目录，构建时由 Vite 直接内联打包，无需后端请求。
 * 仓库内只提供**空模板**（products 为空数组），避免把个人信息带进版本库；
 * 需要预置数据时，按下面的结构自行填写 seed-data.json：
 *
 *   {
 *     "extractedAt": "2026-10-12T05:37:37.667Z",   // 可选，导出时间
 *     "source": "manual",                          // 可选，数据来源说明
 *     "reportSnapshots": 0,                        // 可选，快照条数
 *     "productCodes": 1,                           // 可选，产品数量
 *     "threshold": 0.03,                           // 可选，预警阈值
 *     "products": [
 *       {
 *         "code": "000000A",                       // 产品代码
 *         "name": "示例产品",                       // 产品名
 *         "note": "",                              // 备注
 *         "active": true,                          // 是否监控中
 *         "navHistory": [{ "date": "2026-01-02", "nav": 1.0 }]
 *       }
 *     ]
 *   }
 *
 * 字段映射：navHistory → history；active 直接沿用。
 */

import seed from '../../seed-data.json';

/** 原始种子数据对象。 */
export const SEED_RAW = seed;

/** 种子数据概要（用于界面展示）。 */
export function getSeedSummary() {
  const products = Array.isArray(seed?.products) ? seed.products : [];
  const navPoints = products.reduce(
    (sum, item) => sum + (Array.isArray(item.navHistory) ? item.navHistory.length : 0),
    0,
  );
  return {
    extractedAt: seed?.extractedAt || '',
    source: seed?.source || '',
    reportSnapshots: Number(seed?.reportSnapshots) || 0,
    productCodes: Number(seed?.productCodes) || products.length,
    productCount: products.length,
    activeCount: products.filter((item) => item.active).length,
    navPoints,
    threshold: Number(seed?.threshold) || 0.03,
  };
}
