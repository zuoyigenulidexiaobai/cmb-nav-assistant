import React, { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import { parseDateToken, parseNavText, parseNavToken } from '../lib/parser.js';
import { fmtNav } from '../lib/format.js';

/**
 * 净值录入对话框：单条追加 + 批量粘贴，统一走同一份文本解析。
 *
 * 解析失败的行逐行提示，但不会阻止有效行被保存。
 *
 * @param {{
 *   open: boolean,
 *   product: object|null,
 *   onSubmit: (code:string, points:Array<{date:string,nav:number}>) => {added:number,updated:number,total:number},
 *   onClose: (summary?: object) => void,
 * }} props
 */
export default function NavEntryDialog({ open, product, onSubmit, onClose }) {
  const [text, setText] = useState('');
  const [singleDate, setSingleDate] = useState('');
  const [singleNav, setSingleNav] = useState('');
  const [singleError, setSingleError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setSingleDate('');
      setSingleNav('');
      setSingleError('');
      setSaving(false);
    }
  }, [open, product]);

  const parsed = useMemo(() => parseNavText(text), [text]);

  const existingDates = useMemo(
    () => new Set((product?.history || []).map((point) => point.date)),
    [product],
  );

  const latest = useMemo(() => {
    const history = product?.history || [];
    return history.length ? history[history.length - 1] : null;
  }, [product]);

  const handleAddSingle = () => {
    const date = parseDateToken(singleDate);
    if (!date) {
      setSingleError('日期格式应为 YYYY-MM-DD / YYYYMMDD / YYYY/MM/DD');
      return;
    }
    const nav = parseNavToken(singleNav);
    if (nav === null) {
      setSingleError('净值需为大于 0 的数字');
      return;
    }
    setText((prev) => (prev ? `${prev}\n${date} ${nav}` : `${date} ${nav}`));
    setSingleDate('');
    setSingleNav('');
    setSingleError('');
  };

  const handleSave = async () => {
    if (saving) return;
    if (parsed.points.length === 0) {
      onClose({ saved: 0, errorLines: parsed.errors.length });
      return;
    }
    setSaving(true);
    try {
      const summary = await onSubmit(product.code, parsed.points);
      onClose({ ...summary, saved: parsed.points.length, errorLines: parsed.errors.length });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>
        录入净值
        {product ? (
          <span className="ml-2 text-sm font-bold text-brand-600">{product.code}</span>
        ) : null}
      </DialogTitle>
      <DialogContent dividers>
        <div className="grid gap-4 pt-1">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-muted">
            {latest ? (
              <>
                当前最新净值 <strong className="text-ink">{fmtNav(latest.nav)}</strong>（
                {latest.date}），共 {product.history.length} 个净值点。
              </>
            ) : (
              <>该产品暂无净值数据，请录入第一条记录。</>
            )}
          </div>

          <fieldset className="rounded-xl border border-line px-3 pb-3 pt-2">
            <legend className="px-1 text-xs font-bold text-muted">单条录入</legend>
            <div className="flex flex-wrap items-end gap-2">
              <TextField
                label="净值日期"
                value={singleDate}
                onChange={(event) => setSingleDate(event.target.value)}
                placeholder="2026-07-23 或 20260723"
                size="small"
                sx={{ minWidth: 200 }}
              />
              <TextField
                label="净值"
                value={singleNav}
                onChange={(event) => setSingleNav(event.target.value)}
                placeholder="1.0399"
                size="small"
                sx={{ width: 140 }}
              />
              <Button variant="outlined" onClick={handleAddSingle}>
                加入列表
              </Button>
            </div>
            {singleError ? (
              <p className="mt-2 text-xs font-semibold text-profit">{singleError}</p>
            ) : null}
          </fieldset>

          <TextField
            label="批量粘贴"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'每行一条，格式：日期 净值\n2026-07-22 1.0392\n20260723,1.0399\n2026/07/24\t1.0401'}
            multiline
            minRows={6}
            fullWidth
            size="small"
            helperText="支持分隔符：制表符 / 逗号 / 中文逗号 / 空格；同一日期重复录入将覆盖旧值。"
          />

          <div className="grid gap-2">
            {parsed.points.length > 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-xs font-bold text-loss">
                  已解析 {parsed.points.length} 条有效记录
                  {parsed.errors.length ? `，${parsed.errors.length} 行有误` : ''}
                </p>
                <p className="mt-1 max-h-24 overflow-y-auto text-[11px] leading-relaxed text-muted">
                  {parsed.points
                    .slice(0, 40)
                    .map((point) => `${point.date} ${fmtNav(point.nav)}` + (existingDates.has(point.date) ? '（覆盖）' : ''))
                    .join('　|　')}
                  {parsed.points.length > 40 ? ' …' : ''}
                </p>
              </div>
            ) : null}

            {parsed.errors.length > 0 ? (
              <Alert severity="warning">
                <p className="text-xs font-bold">以下 {parsed.errors.length} 行未能解析（不影响其他行保存）：</p>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-[11px]">
                  {parsed.errors.map((item) => (
                    <li key={`${item.line}-${item.text}`}>
                      第 {item.line} 行「{item.text || '(空)'}」：{item.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </div>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => onClose()} color="inherit">
          取消
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={parsed.points.length === 0 || saving}>
          {saving ? '保存中…' : `保存 ${parsed.points.length > 0 ? `(${parsed.points.length})` : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
