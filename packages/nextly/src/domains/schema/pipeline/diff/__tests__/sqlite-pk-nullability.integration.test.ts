/**
 * What SQLite reports for a primary key, and why it matters.
 *
 * Only INTEGER PRIMARY KEY (the rowid alias) is implicitly NOT NULL in SQLite;
 * a TEXT PRIMARY KEY is nullable at storage level. The snapshot reports that
 * faithfully, because it must describe the database rather than what the
 * schema intended — every other consumer of the snapshot depends on it being
 * true.
 *
 * The consequence is that the desired side, where `.primaryKey()` means NOT
 * NULL, disagrees on every such column. Resolving that disagreement is a
 * question about the data, not the flag, and is handled by the reconcile's
 * probe (see resolve-safe-nullability.ts) rather than by bending this report.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../introspect-live";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function columnsOf(table: string) {
  current = current ?? (await createTestNextly({}));
  const live = await introspectLiveSnapshot(
    current.adapter.getDrizzle(),
    "sqlite",
    [table]
  );
  return live.tables.find(t => t.name === table)?.columns ?? [];
}

describe("sqlite nullability reporting", () => {
  it("reports a text primary key as stored, which SQLite says is nullable", async () => {
    // Reporting NOT NULL here instead would make the snapshot describe intent
    // rather than reality, and would hide a primary key that genuinely holds
    // NULLs along with its destructive-data check.
    const id = (await columnsOf("nextly_events")).find(c => c.name === "id");
    expect(id?.nullable).toBe(true);
  });

  it("reports a NOT NULL column as not nullable", async () => {
    // The report is faithful in both directions, not blanket-permissive.
    const type = (await columnsOf("nextly_events")).find(
      c => c.name === "type"
    );
    expect(type?.nullable).toBe(false);
  });
});
