"use client";

/**
 * What the last reply cost: its status, how long it took, and how big it was.
 *
 * Its own component because it answers a different question from the tabs
 * beside it -- those are "what do I do with this", this is "what happened" --
 * and because it carries a contract the rest of the pane does not: the row must
 * not change size when the values arrive. Everything here that looks like a
 * magic number is that contract. `e2e/tests/api-playground-metrics.spec.ts`
 * measures it, since jsdom computes no layout and cannot.
 *
 * @module components/entries/APIPlayground/ResponseMetrics
 */

import { cn } from "@admin/lib/utils";

/**
 * The status dot, keyed to the same meaning as the status text beside it.
 */
function statusDotTone(status: number): string {
  if (status >= 200 && status < 300) return "bg-success";
  if (status >= 300 && status < 400) return "bg-muted-foreground";
  if (status >= 400 && status < 500) return "bg-warning";
  if (status >= 500) return "bg-destructive";
  return "bg-muted-foreground";
}

/**
 * Colour a response by what its status class means.
 *
 * A 4xx is the caller's mistake and a 5xx is the server's, so they read as
 * warning and error respectively.
 */
function statusTone(status: number): string {
  if (status >= 200 && status < 300) return "text-success";
  if (status >= 300 && status < 400) return "text-muted-foreground";
  if (status >= 400 && status < 500) return "text-warning";
  if (status >= 500) return "text-destructive";
  return "text-muted-foreground";
}

/**
 * A payload size someone can act on.
 *
 * Two significant figures past a kilobyte: the question a size answers here is
 * "is this response big?", and 2.4 KB answers it while 2438 B makes you count
 * digits.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  // Without this arm megabytes never stop counting, so a 5 GiB reply reads
  // `5120.00 MB` -- longer than any width the metrics row can reserve, and
  // harder to size at a glance than the unit it belongs in.
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** One reading in the meta row, with a placeholder that holds its width. */
function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export interface ResponseMetricsProps {
  /** HTTP status, absent until the first reply. */
  status?: number;
  /** Round trip in milliseconds. */
  time?: number;
  /** Body size in bytes — what `depth` and `limit` are traded against. */
  size?: number;
}

export function ResponseMetrics({ status, time, size }: ResponseMetricsProps) {
  /* Always rendered, and every value reserves the width its populated form
  needs. The metrics used to appear with the first reply, so the header
  reflowed at the moment somebody was reading it -- and a placeholder
  alone does not fix that: an em dash is narrower than `200`, `123ms`
  and `5.8 KB`, so at pane widths between the two intrinsic widths the
  row still wrapped on arrival and pushed the toolbar down. The mono
  face advances every glyph equally, so `ch` reserves exactly. */
  return (
    <div
      data-testid="response-meta"
      // Wraps rather than clipping. The pane is resizable, and its minimum
      // against a wide admin sidebar leaves a few hundred pixels -- at which
      // a non-wrapping row puts the metrics past the card's clipped edge.
      className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b border-border px-6 py-2"
    >
      <Metric label="Status">
        {/* Drawn at every moment, coloured only once there is a status. Built
            conditionally, the dot and its gap are 14px that arrive with the
            first reply. */}
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            status === undefined ? "bg-transparent" : statusDotTone(status)
          )}
        />
        <span
          className={cn(
            // 3ch: an HTTP status code is always three digits, so this
            // reserves the exact width rather than an estimate of it.
            "min-w-[3ch] font-mono text-sm font-semibold",
            status === undefined ? "text-muted-foreground" : statusTone(status)
          )}
        >
          {status ?? "—"}
        </span>
      </Metric>
      <div className="h-4 w-px bg-border" />
      <Metric label="Latency">
        {/* 6ch holds `9999ms`. Past ten seconds the value outgrows its
            reservation and the row can reflow again, which is a real change
            in the content rather than the empty-to-populated step this
            reserves against. */}
        <span className="min-w-[6ch] font-mono text-sm font-semibold text-foreground">
          {time === undefined ? "—" : `${time}ms`}
        </span>
      </Metric>
      <div className="h-4 w-px bg-border" />
      {/* Beside latency because they are the pair traded against each other
          when tuning depth and limit. */}
      <Metric label="Size">
        {/* 10ch holds the widest form `formatBytes` produces: `1023.99 MB`
            and `1023.99 GB` are both ten characters, and every smaller unit
            is shorter. A terabyte reply would outgrow it, which no API
            response this pane can render is going to be. */}
        <span className="min-w-[10ch] font-mono text-sm font-semibold text-foreground">
          {size === undefined ? "—" : formatBytes(size)}
        </span>
      </Metric>
    </div>
  );
}
