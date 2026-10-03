// The adapter surface `runFileMigrations` touches, over a raw better-sqlite3
// handle, for integration tests that drive migrations without a full adapter.
//
// `transaction` is part of that surface: `executeTransaction` runs a
// migration's statements on the transaction's executor so the whole unit
// stays on one connection (#1964). One copy here rather than one per test, so
// the stub cannot drift from what `runFileMigrations` calls.

import type Database from "better-sqlite3";

import type { runFileMigrations } from "../migrate";

type MigrationAdapter = Parameters<typeof runFileMigrations>[0]["adapter"];

export function makeSqliteMigrationAdapter(
  sqlite: Database.Database,
  db: unknown
): MigrationAdapter {
  const execute = (q: string): Promise<unknown[]> => {
    sqlite.exec(q);
    return Promise.resolve([]);
  };
  return {
    listTables: () =>
      Promise.resolve(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map(r => (r as { name: string }).name)
      ),
    executeQuery: execute,
    transaction: async <T>(
      work: (tx: { execute: typeof execute }) => Promise<T>
    ): Promise<T> => {
      sqlite.exec("BEGIN");
      try {
        const result = await work({ execute });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    getDrizzle: () => db,
  } as unknown as MigrationAdapter;
}
