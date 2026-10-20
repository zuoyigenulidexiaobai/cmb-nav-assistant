import React from 'react';
import Checkbox from '@mui/material/Checkbox';
import Tooltip from '@mui/material/Tooltip';
import { RateCell, StatusPills } from './common.jsx';
import { PERIODS } from '../lib/netvalue.js';
import { fmtDate, fmtNav } from '../lib/format.js';

/**
 * 净值管理表格：支持批量选择与逐行操作。
 * @param {{
 *   rows: Array<{product:object, result:object}>,
 *   selected: Set<string>,
 *   onToggle: Function,
 *   onToggleAll: Function,
 *   allSelected: boolean,
 *   someSelected: boolean,
 *   onEditProduct: Function,
 *   onEditNav: Function,
 *   onEditHolding: Function,
 *   onToggleActive: Function,
 *   onDelete: Function,
 *   onSyncProduct: Function,
 *   syncingCodes?: Set<string>,
 *   syncBusy?: boolean,
 * }} props
 */
export default function ProductTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
  someSelected,
  onEditProduct,
  onEditNav,
  onEditHolding,
  onToggleActive,
  onDelete,
  onSyncProduct,
  syncingCodes,
  syncBusy = false,
}) {
  const headerCheckbox = (
    <Checkbox
      size="small"
      checked={allSelected}
      indeterminate={!allSelected && someSelected}
      onChange={(event) => onToggleAll(event.target.checked)}
      inputProps={{ 'aria-label': '全选' }}
    />
  );

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table min-w-[1020px]">
          <thead>
            <tr>
              <th className="w-10">{headerCheckbox}</th>
              <th>产品</th>
              <th className="text-right">最新净值</th>
              <th>净值日期</th>
              {PERIODS.map((period) => (
                <th key={period.key} className="text-right">
                  {period.label}
                </th>
              ))}
              <th className="text-right">状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ product, result }) => (
              <tr key={product.code} className={!product.active ? 'opacity-60' : ''}>
                <td>
                  <Checkbox
                    size="small"
                    checked={selected.has(product.code)}
                    onChange={() => onToggle(product.code)}
                    inputProps={{ 'aria-label': `选择 ${product.code}` }}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-ink">{product.code}</span>
                    {!product.active ? <span className="pill pill-neutral">已归档</span> : null}
                  </div>
                  <div
                    className="mt-0.5 max-w-[220px] truncate text-xs text-muted"
                    title={
                      product.name
                        ? product.name
                        : '尚无名称：抓取净值或点页头「同步产品名」可从招行补全'
                    }
                  >
                    {product.name || '未命名产品'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    净值点 {product.history.length} 个
                  </div>
                </td>
                <td className="text-right">
                  <span className="text-sm font-bold text-ink">{fmtNav(result.latestNav)}</span>
                </td>
                <td className="whitespace-nowrap text-xs text-muted">
                  {fmtDate(result.latestDate)}
                </td>
                {PERIODS.map((period) => (
                  <td key={period.key} className="text-right">
                    <RateCell label="" period={result.periods?.[period.key]} />
                  </td>
                ))}
                <td className="text-right">
                  <StatusPills result={result} />
                </td>
                <td>
                  <div className="flex flex-nowrap justify-end gap-1.5">
                    <Tooltip title="抓取该产品的最新净值">
                      <span>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={syncBusy}
                          onClick={() => onSyncProduct(product)}
                        >
                          {syncingCodes?.has(product.code) ? '抓取中…' : '抓取'}
                        </button>
                      </span>
                    </Tooltip>
                    <Tooltip title="录入 / 批量粘贴净值">
                      <button type="button" className="btn-ghost" onClick={() => onEditNav(product)}>
                        净值
                      </button>
                    </Tooltip>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onEditHolding(product)}
                    >
                      持仓
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onEditProduct(product)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onToggleActive(product)}
                    >
                      {product.active ? '归档' : '恢复'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost-danger"
                      onClick={() => onDelete(product.code)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
