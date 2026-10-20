import { createTheme } from '@mui/material/styles';

/**
 * MUI 主题：浅色金融风，与 Tailwind 设计令牌保持一致。
 * 用量克制，主体布局交给 Tailwind。
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2f6bff', dark: '#1f55df', light: '#5c8dff' },
    error: { main: '#d83a3a' },
    success: { main: '#168355' },
    warning: { main: '#a86600' },
    background: { default: '#eef3fb', paper: '#ffffff' },
    text: { primary: '#141b2d', secondary: '#65738a' },
    divider: '#dbe3ee',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 14 },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: '#fff' },
      },
    },
  },
});
