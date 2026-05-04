"use client";

import type React from "react";

/**
 * Rail panel placeholder for entry activity / comments. Wired into the
 * actual activity feature in a follow-up task; this PR ships the slot so
 * the rail layout is final.
 */
export function ActivityPanel(): React.ReactElement {
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-1.5">
        Activity
      </p>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}
