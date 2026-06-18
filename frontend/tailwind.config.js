/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          deep: "#020203",
          base: "#050506",
          elevated: "#0a0a0c",
        },
        accent: {
          DEFAULT: "#5E6AD2",
          bright: "#6872D9",
          glow: "rgba(94, 106, 210, 0.3)",
        },
        foreground: {
          DEFAULT: "#EDEDEF",
          muted: "#8A8F98",
          subtle: "rgba(255, 255, 255, 0.60)",
        },
        border: {
          default: "rgba(255, 255, 255, 0.06)",
          hover: "rgba(255, 255, 255, 0.10)",
          accent: "rgba(94, 106, 210, 0.30)",
        },
      },
      animation: {
        "float": "float 10s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-20px) rotate(1deg)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      backgroundImage: {
        "noise": "url('/noise.svg')",
      },
    },
  },
  plugins: [],
}
