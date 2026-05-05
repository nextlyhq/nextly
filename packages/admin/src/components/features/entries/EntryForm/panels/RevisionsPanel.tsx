"use client";

import type React from "react";

/**
 * Rail panel placeholder for entry revisions / version history. Wired into
 * the actual versions feature in a follow-up task; this PR ships the slot
 * so the rail layout is final.
 */
export function RevisionsPanel(): React.ReactElement {
  return (
    <div className="px-5 py-4 border-b border-primary/5">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-1.5">
        Revisions
      </p>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  );
}
