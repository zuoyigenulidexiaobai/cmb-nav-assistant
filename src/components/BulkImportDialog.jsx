import React, { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import { parseProductCodes } from '../lib/parser.js';

/**
 * 批量录入产品代码对话框。
 * @param {{
 *   open: boolean,
 *   existingCodes: string[],
 *   onClose: Function,
 *   onSubmit: (codes:string[]) => {added:string[], skipped:string[]},
 * }} props
 */
export default function BulkImportDialog({ open, existingCodes, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  const preview = useMemo(() => {
    const codes = parseProductCodes(text);
    const existing = new Set(existingCodes);
    const seen = new Set();
    const fresh = [];
    const duplicated = [];
    for (const code of codes) {
      if (existing.has(code) || seen.has(code)) {
        duplicated.push(code);
        continue;
      }
      seen.add(code);
      fresh.push(code);
    }
    return { codes, fresh, duplicated };
  }, [text, existingCodes]);

  const handleSubmit = async () => {
    if (busy) return;
    if (preview.fresh.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const summary = await onSubmit(preview.fresh);
      setResult({
        added: Array.isArray(summary?.added) ? summary.added : [],
        skipped: Array.isArray(summary?.skipped) ? summary.skipped : [],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>批量录入产品代码</DialogTitle>
      <DialogContent dividers>
        <div className="grid gap-4 pt-1">
          <TextField
            label="产品代码"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'用逗号、中文逗号、分号、空格或换行分隔\n例如：123456A,123457A\nAB012345；AB012346'}
            multiline
            minRows={6}
            fullWidth
            size="small"
            helperText="代码将统一转为大写并自动去重，已存在的代码会被跳过。"
          />

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="pill pill-neutral">识别 {preview.codes.length} 个</span>
            <span className="pill pill-ok">新增 {preview.fresh.length} 个</span>
            <span className="pill pill-warn">重复/已存在 {preview.duplicated.length} 个</span>
          </div>

          {preview.fresh.length > 0 ? (
            <p className="max-h-24 overflow-y-auto rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-muted">
              将新增：{preview.fresh.join('、')}
            </p>
          ) : null}

          {result ? (
            <Alert severity="success">
              已新增 {result.added.length} 个产品
              {result.skipped.length ? `，跳过 ${result.skipped.length} 个已存在代码` : ''}。
            </Alert>
          ) : null}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          {result ? '完成' : '取消'}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={preview.fresh.length === 0 || busy}
        >
          {busy ? '新增中…' : `新增 ${preview.fresh.length > 0 ? `(${preview.fresh.length})` : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
