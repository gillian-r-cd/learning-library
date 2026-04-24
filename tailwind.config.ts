import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f19",
        panel: "#131929",
        panel2: "#1a2236",
        border: "#242d45",
        text: "#e5eaf4",
        muted: "#8892a6",
        accent: "#6aa6ff",
        good: "#3ecf8e",
        warn: "#f3b94d",
        bad: "#ef6a6a",
      },
    },
  },
  plugins: [],
} satisfies Config;
