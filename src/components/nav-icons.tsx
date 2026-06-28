import type { ReactNode } from "react";

/**
 * Small line icons for the primary nav, keyed by the nav item's `key` so both the
 * desktop header (server) and the mobile drawer (client) render the same glyph
 * without passing JSX through props. Stroke-based, inherit `currentColor` + size.
 */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function navIcon(key: string): ReactNode {
  switch (key) {
    case "market": // Home / order book
      return (
        <Svg>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </Svg>
      );
    case "orders":
      return (
        <Svg>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </Svg>
      );
    case "mine": // My ads
      return (
        <Svg>
          <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" />
          <path d="M15 8a5 5 0 0 1 0 8" />
        </Svg>
      );
    case "dashboard": // Account / wallet
      return (
        <Svg>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <circle cx="16.5" cy="14" r="1.2" />
        </Svg>
      );
    case "admin":
      return (
        <Svg>
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />
          <path d="M9.5 12l1.8 1.8L15 10" />
        </Svg>
      );
    default:
      return null;
  }
}
