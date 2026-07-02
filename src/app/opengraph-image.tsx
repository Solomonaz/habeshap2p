import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// Static branded share card shown when a habeshap2p.online link is posted to
// Telegram / WhatsApp / X / Facebook. 1200×630 is the standard OG size.
export const alt = "HabeshaP2P — USDT ↔ ETB escrow exchange";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STAGES = [
  { label: "Locked", color: "#f5b43c" },
  { label: "Paid", color: "#7aa2f7" },
  { label: "Released", color: "#1d9e75" },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0e11",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 20,
              height: 20,
              borderRadius: 6,
              background: "#f5b43c",
            }}
          />
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: "#e8eaed" }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 800,
              color: "#e8eaed",
              lineHeight: 1.1,
              letterSpacing: -1,
            }}
          >
            USDT ↔ ETB, settled with
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 800,
              color: "#f5b43c",
              lineHeight: 1.1,
              letterSpacing: -1,
            }}
          >
            escrow you can trust.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 30,
              color: "#a9b0b8",
              maxWidth: 900,
            }}
          >
            Peer-to-peer exchange for the Ethiopian diaspora. Crypto held in
            escrow — never auto-released.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {STAGES.map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    display: "flex",
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: s.color,
                  }}
                />
                <div style={{ display: "flex", fontSize: 26, color: "#e8eaed" }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#6b7280" }}>
            habeshap2p.online
          </div>
        </div>
      </div>
    ),
    size,
  );
}
