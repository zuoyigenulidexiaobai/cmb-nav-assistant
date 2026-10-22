import React, { useCallback, useMemo, useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Layout from './components/Layout.jsx';
import Dashboard from './views/Dashboard.jsx';
import NavManager from './views/NavManager.jsx';
import TrendView from './views/TrendView.jsx';
import BuyCheck from './views/BuyCheck.jsx';
import HoldingsView from './views/HoldingsView.jsx';
import DataManager from './views/DataManager.jsx';
import { usePortfolio } from './hooks/usePortfolio.js';

/**
 * 应用根组件：视图切换 + 全局提示。
 */
export default function App() {
  const [view, setView] = useState('dashboard');
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });
  const { stats, products } = usePortfolio();

  const notify = useCallback((message, severity = 'success') => {
    setToast({ open: true, message, severity });
  }, []);

  const closeToast = useCallback(() => {
    setToast((prev) => ({ ...prev, open: false }));
  }, []);

  const badges = useMemo(
    () => ({
      dashboard: stats.underThreshold + stats.stale,
      nav: products.length,
    }),
    [stats, products],
  );

  return (
    <>
      <Layout view={view} onNavigate={setView} badges={badges}>
        {view === 'dashboard' ? <Dashboard onNavigate={setView} notify={notify} /> : null}
        {view === 'nav' ? <NavManager notify={notify} onNavigate={setView} /> : null}
        {view === 'trend' ? <TrendView notify={notify} onNavigate={setView} /> : null}
        {view === 'buycheck' ? <BuyCheck notify={notify} onNavigate={setView} /> : null}
        {view === 'holdings' ? <HoldingsView notify={notify} onNavigate={setView} /> : null}
        {view === 'data' ? <DataManager notify={notify} onNavigate={setView} /> : null}
      </Layout>

      <Snackbar
        open={toast.open}
        autoHideDuration={3600}
        onClose={closeToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} variant="filled" onClose={closeToast}>
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  );
}
