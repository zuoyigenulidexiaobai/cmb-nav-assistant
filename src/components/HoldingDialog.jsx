import React, { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import { parseHoldingInput } from '../lib/parser.js';
import { fmtMoney, fmtNav, fmtPercent } from '../lib/format.js';

/**
 * 持仓录入 / 编辑对话框。
 * @param {{
 *   open: boolean,
 *   product: object|null,
 *   latestNav: number|null,
 *   onClose: Function,
 *   onSubmit: (code:string, holding:{shares:number,costNav:number}|null) => void,
 * }} props
 */
export default function HoldingDialog({ open, product, latestNav, onClose, onSubmit }) {
  const [shares, setShares] = useState('');
  const [costNav, setCostNav] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setShares(product?.holding ? String(product.holding.shares) : '');
    setCostNav(product?.holding ? String(product.holding.costNav) : '');
    setError('');
  }, [open, product]);

  const preview = useMemo(() => {
    const parsedShares = Number(shares);
    const parsedCost = Number(costNav);
    if (!Number.isFinite(parsedShares) || !Number.isFinite(parsedCost)) return null;
    if (parsedShares < 0 || parsedCost <= 0 || !Number.isFinite(latestNav)) return null;
    const cost = parsedShares * parsedCost;
    const marketValue = parsedShares * latestNav;
    const profit = marketValue - cost;
    return {
      cost,
      marketValue,
      profit,
      profitRate: cost > 0 ? profit / cost : NaN,
    };
  }, [shares, costNav, latestNav]);

  const handleSubmit = () => {
    const parsed = parseHoldingInput({ shares, costNav });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    onSubmit(product.code, parsed.value);
    onClose();
  };

  const handleClear = () => {
    onSubmit(product.code, null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>
        持仓设置
        {product ? (
          <span className="ml-2 text-sm font-bold text-brand-600">{product.code}</span>
        ) : null}
      </DialogTitle>
      <DialogContent dividers>
        <div className="grid gap-4 pt-1">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-muted">
            最新净值 <strong className="text-ink">{fmtNav(latestNav)}</strong>。留空两项即可清除持仓记录。
          </p>
          <TextField
            label="持有份额"
            value={shares}
            onChange={(event) => setShares(event.target.value)}
            placeholder="例如 10000"
            type="number"
            fullWidth
            size="small"
          />
          <TextField
            label="成本净值"
            value={costNav}
            onChange={(event) => setCostNav(event.target.value)}
            placeholder="例如 1.0000"
            type="number"
            fullWidth
            size="small"
            inputProps={{ step: '0.0001' }}
          />
          {preview ? (
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-white px-3 py-2 text-center">
              <div>
                <p className="text-[11px] text-muted">市值</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{fmtMoney(preview.marketValue)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted">持有收益</p>
                <p
                  className={`mt-0.5 text-sm font-bold ${
                    preview.profit >= 0 ? 'text-profit' : 'text-loss'
                  }`}
                >
                  {fmtMoney(preview.profit)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted">收益率</p>
                <p
                  className={`mt-0.5 text-sm font-bold ${
                    preview.profitRate >= 0 ? 'text-profit' : 'text-loss'
                  }`}
                >
                  {fmtPercent(preview.profitRate)}
                </p>
              </div>
            </div>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {product?.holding ? (
          <Button onClick={handleClear} color="error" sx={{ mr: 'auto' }}>
            清除持仓
          </Button>
        ) : null}
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={handleSubmit} variant="contained">
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
