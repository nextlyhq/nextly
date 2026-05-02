// Fullscreen overlay shown during server restart after schema changes.
// Displays pulsing dots animation with status text that updates over time.
"use client";

import { useRestart } from "@admin/context/RestartContext";

export function RestartOverlay() {
  const { isRestarting, statusMessage, statusDetail } = useRestart();

  if (!isRestarting) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      role="status"
      aria-label="Server is restarting"
    >
      <div className="text-center text-white">
        {/* Pulsing dots animation */}
        <div className="mb-4 flex items-center justify-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-none bg-white animate-pulse"
            style={{ animationDelay: "0s" }}
          />
          <span
            className="inline-block h-2 w-2 rounded-none bg-white animate-pulse"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="inline-block h-2 w-2 rounded-none bg-white animate-pulse"
            style={{ animationDelay: "0.4s" }}
          />
        </div>

        <p className="text-sm font-medium">{statusMessage}</p>
        <p className="mt-1 text-xs text-white/60">{statusDetail}</p>
      </div>
    </div>
  );
}
