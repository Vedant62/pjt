import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cashew: { 50: "#fdf7ef", 100: "#f9ead6", 200: "#f2d1a8", 400: "#e09a52", 500: "#d27d2d", 600: "#b86422", 700: "#934c1f", 900: "#4d2814" },
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
