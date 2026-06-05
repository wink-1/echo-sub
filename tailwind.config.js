/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        'sub-bg': 'rgba(0, 0, 0, 0.75)',
        'sub-text': '#ffffff',
        'sub-highlight': '#fbbf24',
        'sub-partial': 'rgba(255, 255, 255, 0.5)'
      },
      fontSize: {
        'sub-sm': '16px',
        'sub-md': '24px',
        'sub-lg': '32px',
        'sub-xl': '36px'
      }
    }
  },
  plugins: []
}
