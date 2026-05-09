// F10 PR 3 — TerminalChannel.
//
// Writes a boxed multi-line summary to stdout (or a writer override
// for testing). ASCII-only borders for portability across Windows
// terminals + CI log streams (no fancy box-drawing characters that
// might mojibake in dumb terminals).

import type {
  MigrationNotificationEvent,
  MigrationScope,
  MigrationSummary,
  NotificationChannel,
} from "../types";

interface TerminalChannelOpts {
  writer?: (chunk: string) => void;
}

export class TerminalChannel implements NotificationChannel {
  readonly name = "terminal";
  private readonly writer: (chunk: string) => void;

  constructor(opts: TerminalChannelOpts = {}) {
    this.writer = opts.writer ?? (chunk => process.stdout.write(chunk));
  }

  write(event: MigrationNotificationEvent): Promise<void> {
    // CONFIRMATION_REQUIRED_NO_TTY is not a failure; it is a
    // "user input required" pause. The reload-config caller prints
    // a clear top-level instruction in that case (run db:sync,
    // migrate:create, or use the admin UI). Emitting an additional
    // boxed "Schema apply FAILED" line here would be both
    // redundant and misleading because it reads as a real bug.
    if (
      event.status === "failed" &&
      event.error.code === "CONFIRMATION_REQUIRED_NO_TTY"
    ) {
      return Promise.resolve();
    }

    const title =
      event.status === "success"
        ? `Schema applied — ${describeScope(event.scope)}`
        : `Schema apply FAILED — ${describeScope(event.scope)}`;

    const detail =
      event.status === "success"
        ? describeSummary(event.summary)
        : event.error.message;

    const meta = `${event.source === "ui" ? "ui" : "hmr"} · ${event.durationMs}ms`;

    const box = boxify([title, detail, meta]);
    this.writer(box + "\n");
    return Promise.resolve();
  }
}

function describeScope(scope: MigrationScope): string {
  if (scope.kind === "fresh-push") return "fresh-push";
  if (scope.kind === "global") {
    return scope.slug ? `global:${scope.slug}` : "global";
  }
  return `${scope.kind}:${scope.slug}`;
}

function describeSummary(s: MigrationSummary): string {
  const parts: string[] = [];
  if (s.added) parts.push(`${s.added} added`);
  if (s.removed) parts.push(`${s.removed} removed`);
  if (s.renamed) parts.push(`${s.renamed} renamed`);
  if (s.changed) parts.push(`${s.changed} changed`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

function boxify(lines: string[]): string {
  const minWidth = 20;
  const width = Math.max(...lines.map(l => l.length), minWidth);
  const border = `+${"-".repeat(width + 2)}+`;
  const padded = lines.map(l => `| ${l.padEnd(width)} |`);
  return [border, ...padded, border].join("\n");
}
