/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#156cfa', // Accent Color / Interactive Elements
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#002C5F', // Dark Blue for Structure (like sidebar)
          950: '#091533',
        },
        adnoc: {
          blue: '#002C5F', // Reverted to Dark Navy for structure (Sidebar/Header)
          light: '#156cfa', // Using the bright blue as the secondary/accent color
          sand: '#f59e0b', // Accent amber
          gray: '#F8FAFC',
        }
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(21, 108, 250, 0.2)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
      }
    },
  },
  plugins: [],
}
