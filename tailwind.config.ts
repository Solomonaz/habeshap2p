import type { Config } from "tailwindcss";

/**
 * Design language: standard crypto-exchange dark UI (Binance / Bybit family).
 * Deep near-black canvas, layered graphite surfaces, light text, a single gold
 * accent for primary actions, and green/red for buy/sell. Monetary amounts stay
 * monospace + tabular for column alignment.
 *
 * Token names are kept from the earlier palette so existing markup keeps
 * resolving — only the VALUES changed (e.g. `ink` is now light text on dark,
 * `paper` is now the dark surface ramp).
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark surface ramp (was "paper"): canvas -> raised cards -> sunken rows
        paper: {
          DEFAULT: "#0b0e11", // page canvas
          raised: "#181a20", // cards / header
          sunken: "#1e2329", // input fields, table rows, chips
          border: "#2b3139", // hairlines
        },
        // Text ramp (was "ink"): now light-on-dark
        ink: {
          DEFAULT: "#eaecef", // primary text
          soft: "#c7ccd6", // secondary
          muted: "#848e9c", // labels / muted
          faint: "#5e6673", // faint / disabled
        },
        // Gold accent — primary actions + escrow emphasis (Binance yellow)
        amber: {
          DEFAULT: "#fcd535",
          soft: "#f0b90b",
          wash: "#2b2611", // dark gold wash for badges/backgrounds
        },
        // Buy/sell directional colors
        buy: {
          DEFAULT: "#0ecb81",
          wash: "#0e1f1b",
        },
        sell: {
          DEFAULT: "#f6465d",
          wash: "#251316",
        },
        // Semantic escrow-rail states
        state: {
          locked: "#848e9c", // funds held (neutral grey-blue)
          paid: "#fcd535", // awaiting seller (gold)
          released: "#0ecb81", // success (green)
          cancelled: "#5e6673", // terminal/void (faint)
          disputed: "#f6465d", // frozen (red)
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
