// Shared dialect-aware tx-statement runner used by the pre-resolution
// and pre-cleanup executors. Keeps the dispatch logic in one place so
// the two callers stay in lockstep — F8 PR 7 review caught a divergence
// where pre-cleanup hadn't yet learned the SQLite shape, crashing every
// SQLite project on NOT-NULL coercion.
//
// Per-dialect tx contracts:
//   - PG / MySQL: drizzle-orm's tx exposes async `execute(sql)`.
//   - SQLite (better-sqlite3): drizzle-orm/better-sqlite3 exposes sync
//     `run(sql)`. better-sqlite3 has no async API; the sync call is
//     intentionally awaited at the caller for uniform shape.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

interface AsyncExecuteHandle {
  execute: (q: unknown) => Promise<unknown>;
}

interface SyncRunHandle {
  run: (q: unknown) => unknown;
}

/**
 * Run a single SQL statement on the given transaction (or DB) handle,
 * dispatching on dialect to pick `.execute()` vs `.run()`. Throws if
 * the underlying call throws — callers wrap in try/catch where the
 * surrounding pipeline phase needs error classification.
 */
export async function runStatement(
  txOrDb: unknown,
  dialect: SupportedDialect,
  stmt: unknown
): Promise<void> {
  if (dialect === "sqlite") {
    (txOrDb as SyncRunHandle).run(stmt);
    return;
  }
  await (txOrDb as AsyncExecuteHandle).execute(stmt);
}
