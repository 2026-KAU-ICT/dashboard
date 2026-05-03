import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 22px 70px rgba(0, 0, 0, 0.34)',
      },
      animation: {
        pulseDanger: 'pulseDanger 0.7s ease-in-out infinite',
        scan: 'scan 5s linear infinite',
        softBlink: 'softBlink 1.2s ease-in-out infinite',
      },
      keyframes: {
        pulseDanger: {
          '0%, 100%': {
            transform: 'translate(-50%, -50%) scale(1)',
            boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.66)',
          },
          '50%': {
            transform: 'translate(-50%, -50%) scale(1.22)',
            boxShadow: '0 0 0 18px rgba(239, 68, 68, 0)',
          },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        softBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.42' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
