"use client";

import { useEffect, useState } from "react";
import { getPresence } from "@/app/presence-actions";
import { isOnline, presenceLabel } from "@/lib/presence";

/**
 * Live online/offline indicator for another user (migration 0042). Seeds from the
 * SSR snapshot (`initialLastSeen`), then polls every 25s so a buyer can watch a
 * seller come online before sending money. A green pulsing dot = online; a grey
 * dot + "last seen…" = offline.
 */
export function PresenceBadge({
  userId,
  initialLastSeen,
  className = "",
}: {
  userId: string;
  initialLastSeen: string | null;
  className?: string;
}) {
  const [lastSeen, setLastSeen] = useState<string | null>(initialLastSeen);
  // A tick to re-derive the relative label as time passes even without a poll.
  const [, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const res = await getPresence(userId);
      if (active) setLastSeen(res.lastSeen);
    };
    void poll();
    const pollId = setInterval(poll, 25_000);
    const tickId = setInterval(() => active && setTick((t) => t + 1), 30_000);
    return () => {
      active = false;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [userId]);

  const online = isOnline(lastSeen);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${className}`}
      title={presenceLabel(lastSeen)}
    >
      <span className="relative flex h-2 w-2">
        {online && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-buy opacity-75" />
        )}
        <span
          className={
            "relative inline-flex h-2 w-2 rounded-full " +
            (online ? "bg-buy" : "bg-ink-faint")
          }
        />
      </span>
      <span className={online ? "text-buy" : "text-ink-faint"}>
        {presenceLabel(lastSeen)}
      </span>
    </span>
  );
}
