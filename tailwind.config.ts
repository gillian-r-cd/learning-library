import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f7f4ec",
        panel: "#ffffff",
        panel2: "#fff9ee",
        border: "#e7decf",
        text: "#253044",
        muted: "#7a8496",
        accent: "#3b82f6",
        "accent-soft": "#dbeafe",
        good: "#16a34a",
        warn: "#f59e0b",
        bad: "#dc2626",
      },
    },
  },
  plugins: [],
} satisfies Config;
