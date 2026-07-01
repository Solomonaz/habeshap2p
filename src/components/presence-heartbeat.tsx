"use client";

import { useEffect } from "react";
import { touchPresence } from "@/app/presence-actions";

/**
 * Invisible presence heartbeat (migration 0042). Mounted once in the site header
 * so every signed-in page keeps the user's last_seen_at fresh: immediately on
 * mount, then every ~50s, and again whenever the tab regains focus/visibility
 * (so coming back from a background tab flips them back to "online" at once).
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    let active = true;
    const beat = () => {
      if (active && document.visibilityState === "visible") {
        void touchPresence();
      }
    };
    beat(); // stamp immediately on load
    const id = setInterval(beat, 50_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
