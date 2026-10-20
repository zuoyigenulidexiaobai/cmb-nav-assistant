/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff5ff',
          100: '#dbe8ff',
          200: '#bcd3ff',
          300: '#8fb4ff',
          400: '#5c8dff',
          500: '#2f6bff',
          600: '#1f55df',
          700: '#1a45b8',
          800: '#173a94',
        },
        ink: '#141b2d',
        muted: '#65738a',
        faint: '#8a97ab',
        line: '#dbe3ee',
        canvas: '#eef3fb',
        // 国内习惯：涨=红，跌=绿
        profit: '#d83a3a',
        loss: '#168355',
        warn: '#a86600',
      },
      fontFamily: {
        sans: [
          'Inter',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 10px 30px rgba(40, 64, 102, 0.08)',
        pop: '0 24px 80px rgba(23, 32, 42, 0.24)',
      },
      borderRadius: {
        xl2: '14px',
      },
    },
  },
  plugins: [],
};
