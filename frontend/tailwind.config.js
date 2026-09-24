/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: {
          950: "#070b14",
          900: "#0b1120",
          800: "#111a2e",
          700: "#1a2440",
        },
        loop: {
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
        },
      },
    },
  },
  plugins: [],
};
