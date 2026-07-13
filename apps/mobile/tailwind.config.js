/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        base: "#0a0a0a",
        surface: "#121212",
        elevated: "#181818",
        highlight: "#1f1f1f",
        hover: "#2a2a2a",
        border: "#282828",
        "border-strong": "#3a3a3a",
        text: "#ffffff",
        "text-secondary": "#b3b3b3",
        "text-muted": "#6a6a6a",
        accent: "#1db954",
        "accent-hover": "#1ed760",
        "accent-dim": "#14532d",
        "accent-fg": "#052e16",
        danger: "#e91429",
        "danger-bg": "#3a1212",
        "danger-fg": "#ffb4b4",
        "warning-bg": "#3a2a10",
        "warning-fg": "#f0c674",
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
    },
  },
  plugins: [],
};
