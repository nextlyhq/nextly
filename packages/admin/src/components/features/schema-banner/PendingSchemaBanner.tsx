// Global top-bar banner that surfaces a code-first schema change the wrapper
// is waiting to apply. Mounted once in RootLayout so it appears on every
// admin page.
//
// Design rationale: uses the same @revnixhq/ui Alert component family as
// SchemaChangeDialog for visual consistency. Classification drives the
// accent colour (amber for destructive/interactive, muted for safe).
// Polls the wrapper pending endpoint every 3s, which is cheap because the
// handler just reads a globalThis ref (no DB). 3s matches typical human
// reaction time between saving a file and noticing the UI.
"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@revnixhq/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, RefreshCcw } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { schemaApi } from "../../../services/schemaApi";

const POLL_INTERVAL_MS = 3000;

export function PendingSchemaBanner() {
  // dismissedKey lets the user hide a specific pending change. If a NEW
  // change arrives (different slug or timestamp), the banner re-appears.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["schema-pending"],
    // Fallback to { pending: null } so the query fn never returns undefined.
    // TanStack Query rejects undefined ("Query data cannot be undefined").
    // The endpoint returns { pending: null } normally but fetch errors or
    // auth failures before login can leave the response unparsed.
    queryFn: async () => {
      try {
        const result = await schemaApi.getPending();
        return result ?? { pending: null };
      } catch {
        return { pending: null };
      }
    },
    refetchInterval: POLL_INTERVAL_MS,
    // Avoid hammering the endpoint on window focus; poll cadence is enough.
    refetchOnWindowFocus: false,
  });

  const pending = data?.pending ?? null;
  if (!pending) return null;

  const pendingKey = `${pending.slug}:${pending.receivedAt}`;
  if (dismissedKey === pendingKey) return null;

  const isDestructive =
    pending.classification === "destructive" ||
    pending.classification === "interactive";

  // Build a short summary: "Add 2 fields", "Drop 1 field", etc.
  const summary = describeDiff(pending.diff);

  return (
    <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Alert
        // Alert variants available: destructive | success | warning | info.
        // Destructive/interactive changes use warning; safe changes use info.
        variant={isDestructive ? "warning" : "info"}
        className={cn("rounded-none border-x-0 border-t-0 py-3")}
      >
        <div className="flex items-start gap-3">
          {isDestructive ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 flex-none" />
          )}
          <div className="flex-1 min-w-0">
            <AlertTitle className="text-sm font-semibold">
              Schema change pending for{" "}
              <span className="font-mono">{pending.slug}</span>
            </AlertTitle>
            <AlertDescription className="text-sm">
              {summary}
              {isDestructive && (
                <span className="ml-1 font-medium">
                  Review required before this can apply.
                </span>
              )}
            </AlertDescription>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <Button size="sm" variant="outline" asChild className="h-8">
              <a href={`/dashboard/collections/builder/${pending.slug}`}>
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                Review
              </a>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setDismissedKey(pendingKey)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}

// Produces a short human summary of the diff shape without dumping field names.
// "added 2 fields, removed 1" reads better in a banner than "+ title, + body, - legacy".
function describeDiff(diff: unknown): string {
  const d = diff as {
    added?: unknown[];
    removed?: unknown[];
    changed?: unknown[];
  };
  const parts: string[] = [];
  if (d.added && d.added.length) {
    parts.push(
      `added ${d.added.length} field${d.added.length === 1 ? "" : "s"}`
    );
  }
  if (d.removed && d.removed.length) {
    parts.push(
      `removed ${d.removed.length} field${d.removed.length === 1 ? "" : "s"}`
    );
  }
  if (d.changed && d.changed.length) {
    parts.push(
      `changed ${d.changed.length} field${d.changed.length === 1 ? "" : "s"}`
    );
  }
  if (parts.length === 0) return "Pending change detected.";
  return `Pending: ${parts.join(", ")}.`;
}
