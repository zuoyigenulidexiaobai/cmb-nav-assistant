import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import App from './App.jsx';
import LoginGate from './components/LoginGate.jsx';
import { PortfolioProvider } from './hooks/usePortfolio.js';
import { theme } from './theme.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <PortfolioProvider>
        <LoginGate>
          <App />
        </LoginGate>
      </PortfolioProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
