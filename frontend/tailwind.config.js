/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0f766e',
          dark: '#134e4a'
        }
      },
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
        display: ['Space Grotesk', 'Manrope', 'sans-serif'],
        mono: ['Consolas', '"Courier New"', 'monospace']
      },
      boxShadow: {
        card: '0 10px 25px rgba(15, 23, 42, 0.08)'
      },
      borderRadius: {
        card: '14px'
      }
    }
  },
  plugins: []
};
