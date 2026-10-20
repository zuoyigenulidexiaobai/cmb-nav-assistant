import React, { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';

/**
 * 新增 / 编辑产品基础信息。
 * @param {{
 *   open: boolean,
 *   mode: 'create'|'edit',
 *   initial: object|null,
 *   onSubmit: (payload:{code:string,name:string,note:string}) => {ok:boolean,error:string},
 *   onClose: Function,
 * }} props
 */
export default function ProductFormDialog({ open, mode, initial, onSubmit, onClose }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(initial?.code || '');
    setName(initial?.name || '');
    setNote(initial?.note || '');
    setError('');
    setBusy(false);
  }, [open, initial]);

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await onSubmit({ code: code.trim().toUpperCase(), name, note });
      if (result && result.ok === false) {
        setError(result.error || '保存失败');
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>
        {mode === 'edit' ? '编辑产品' : '新增产品'}
      </DialogTitle>
      <DialogContent dividers>
        <div className="grid gap-4 pt-1">
          <TextField
            label="产品代码"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="例如 AB012345"
            autoFocus
            fullWidth
            size="small"
            helperText="统一转为大写，作为产品唯一标识"
          />
          <TextField
            label="自定义名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="可选，例如 某某理财 30 天持有期"
            fullWidth
            size="small"
          />
          <TextField
            label="备注"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="可选"
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
