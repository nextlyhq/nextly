// Fullscreen overlay shown during server restart after schema changes.
// Displays pulsing dots animation with status text that updates over time.
"use client";

import { useRestart } from "@admin/context/RestartContext";

export function RestartOverlay() {
  const { isRestarting, statusMessage, statusDetail } = useRestart();

  if (!isRestarting) return null;

  // This covers the whole app while the server is down, so it is its own dark
  // surface rather than a themed one. `--nx-overlay-strong` rather than the
  // modal scrim: the message is read ON this surface, and the muted detail
  // line is what decides the strength — `text-white/60` is 2.81:1 over the
  // see-through variant on a white page against 5.66:1 here. Pure white would
  // have cleared AA on either, so the heading alone did not decide it. The
  // dots and text stay literal white, read against the scrim rather than
  // against the palette underneath it.
  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-overlay-strong backdrop-blur-sm"
      role="status"
      aria-label="Server is restarting"
    >
      <div className="text-center text-white">
        {/* Pulsing dots animation */}
        <div className="mb-4 flex items-center justify-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse [animation-delay:0s]" />
          <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse [animation-delay:0.2s]" />
          <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse [animation-delay:0.4s]" />
        </div>

        <p className="text-sm font-medium">{statusMessage}</p>
        <p className="mt-1 text-xs text-white/60">{statusDetail}</p>
      </div>
    </div>
  );
}
