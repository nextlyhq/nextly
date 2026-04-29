// F10 PR 3 — pure helper that turns the pipeline's apply state into a
// `MigrationNotificationEvent`. The pipeline calls this after
// `recordEnd` so all channels see one canonical event shape.

import type {
  MigrationNotificationEvent,
  MigrationScope,
  MigrationSummary,
} from "./types.js";

interface BuildSuccessArgs {
  success: true;
  source: "ui" | "code";
  scope: MigrationScope;
  summary: MigrationSummary;
  durationMs: number;
  journalId: string;
  // Test seam: deterministic timestamps in unit tests. Defaults to
  // wall-clock when omitted.
  now?: () => Date;
}

interface BuildFailureArgs {
  success: false;
  source: "ui" | "code";
  scope: MigrationScope;
  // Failure events may carry a partial summary when some statements
  // succeeded before the crash. Optional + Partial<> matches the
  // event shape contract.
  summary?: Partial<MigrationSummary>;
  durationMs: number;
  journalId: string;
  error: { code?: string; message: string };
  now?: () => Date;
}

export function buildNotificationEvent(
  args: BuildSuccessArgs | BuildFailureArgs
): MigrationNotificationEvent {
  const ts = (args.now?.() ?? new Date()).toISOString();
  if (args.success) {
    return {
      ts,
      source: args.source,
      status: "success",
      scope: args.scope,
      summary: args.summary,
      durationMs: args.durationMs,
      journalId: args.journalId,
    };
  }
  return {
    ts,
    source: args.source,
    status: "failed",
    scope: args.scope,
    summary: args.summary,
    durationMs: args.durationMs,
    journalId: args.journalId,
    error: args.error,
  };
}
