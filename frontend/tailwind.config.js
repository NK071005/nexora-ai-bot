/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#060b15",
          900: "#0a1120",
          850: "#0e182b",
          800: "#132038",
          700: "#1b2c4c",
          600: "#253b63",
        },
        graphite: {
          950: "#101319",
          900: "#181c25",
          800: "#232834",
          700: "#333a49",
          600: "#4a5364",
        },
        mist: {
          50: "#f7f8fc",
          100: "#eef1f8",
          200: "#e2e7f1",
          300: "#ccd4e3",
          400: "#98a5bc",
          500: "#6d7a92",
          600: "#4c586d",
        },
        electric: {
          50: "#eff5ff",
          100: "#dbe8ff",
          200: "#c2d8ff",
          300: "#8fb7ff",
          400: "#5b95ff",
          500: "#2f7bff",
          600: "#1c5fe0",
          700: "#1749ae",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif",
        ],
        display: ["Sora", "Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(10,17,32,.06), 0 12px 32px -20px rgba(10,17,32,.28)",
        float: "0 18px 60px -24px rgba(6,11,21,.45)",
        glow: "0 0 0 1px rgba(47,123,255,.22), 0 12px 40px -14px rgba(47,123,255,.5)",
      },
      backgroundImage: {
        "grid-dark":
          "linear-gradient(rgba(91,149,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(91,149,255,.07) 1px, transparent 1px)",
        "brand-glow":
          "radial-gradient(60% 50% at 20% 0%, rgba(47,123,255,.22), transparent 70%), radial-gradient(50% 50% at 90% 20%, rgba(34,211,238,.10), transparent 70%)",
      },
      animation: {
        "fade-in": "fadeIn .25s ease-out",
        "slide-up": "slideUp .3s cubic-bezier(.16,1,.3,1)",
        shimmer: "shimmer 1.8s linear infinite",
        "pulse-ring": "pulseRing 2.2s ease-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-500px 0" },
          "100%": { backgroundPosition: "500px 0" },
        },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(47,123,255,.4)" },
          "70%": { boxShadow: "0 0 0 12px rgba(47,123,255,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(47,123,255,0)" },
        },
      },
    },
  },
  plugins: [],
};
