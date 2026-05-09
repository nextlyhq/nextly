// F10 PR 3 — public types for the notifications module.
//
// One canonical event shape is fanned out to N channels by the
// dispatcher (terminal box, NDJSON log file, future SSE/Slack/etc.).
// Channel failures NEVER block the apply — the dispatcher swallows
// per-channel exceptions and emits a warn log. See ./dispatcher.ts.

export type MigrationScope =
  | { kind: "collection"; slug: string }
  | { kind: "single"; slug: string }
  | { kind: "global"; slug?: string }
  | { kind: "fresh-push" };

export interface MigrationSummary {
  added: number;
  removed: number;
  renamed: number;
  changed: number;
}

interface MigrationNotificationEventBase {
  // ISO-8601 timestamp with milliseconds, UTC. Pipeline sets this when
  // it builds the event so all channels see the same wall-clock value.
  ts: string;
  source: "ui" | "code";
  scope: MigrationScope;
  durationMs: number;
  // Foreign key into nextly_migration_journal.id; lets channels link
  // back to the journal row for richer detail (e.g. NotificationCenter
  // expand-row interaction in F10 PR 5).
  journalId: string;
}

export type MigrationNotificationEvent =
  | (MigrationNotificationEventBase & {
      status: "success";
      summary: MigrationSummary;
    })
  | (MigrationNotificationEventBase & {
      status: "failed";
      // Failure events may carry partial summary when the apply got
      // through some statements before crashing. Optional + Partial<>
      // matches the spec: any combination of the four counters may be
      // omitted (failed-before-diff cases supply nothing).
      summary?: Partial<MigrationSummary>;
      error: { code?: string; message: string };
    });

// One channel = one named output (terminal stdout, NDJSON file, etc.).
// `write` may be async; failures are caught by the dispatcher.
export interface NotificationChannel {
  name: string;
  write(event: MigrationNotificationEvent): Promise<void>;
}

// What the rest of the codebase consumes. The pipeline depends on the
// `Notifier` interface; production wires `createNotifier(...)` and
// tests can swap in a fake.
export interface Notifier {
  notify(event: MigrationNotificationEvent): Promise<void>;
}
