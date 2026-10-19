/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Atkinson Hyperlegible"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Noto Sans"', '"Noto Sans CJK SC"', '"Noto Sans Tamil"', 'sans-serif'],
      },
      colors: {
        scam: '#c81e1e',      // red  — high contrast on white (WCAG AA)
        careful: '#b45309',   // amber-700 — darkened for AA on white
        safe: '#15803d',      // green-700
        ink: '#0f1f2e',
        brand: '#0b4a6f',
        paper: '#f5f7f9',
      },
      fontSize: {
        // Senior-first: body never below 20px.
        base: ['1.25rem', { lineHeight: '1.7' }],   // 20px
        lg: ['1.5rem', { lineHeight: '1.6' }],       // 24px
        xl: ['1.75rem', { lineHeight: '1.5' }],      // 28px
        '2xl': ['2.25rem', { lineHeight: '1.3' }],   // 36px
        '3xl': ['2.75rem', { lineHeight: '1.2' }],   // 44px
      },
      minHeight: {
        tap: '64px',   // minimum tap target
      },
    },
  },
  plugins: [],
}
