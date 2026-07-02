import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1A1A1A',
        charcoal: '#2B2B2B',
        gold: '#C8A96B',
        ivory: '#F8F5EF',
        linen: '#FBF8F1',
        border: '#E6E1D8',
        muted: '#6B7280',
        success: '#2E7D32',
        warning: '#F59E0B',
        danger: '#DC2626',
        info: '#2563EB',
      },
      boxShadow: {
        soft: '0 12px 30px rgba(26, 26, 26, 0.08)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['Georgia', 'Cambria', 'serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
