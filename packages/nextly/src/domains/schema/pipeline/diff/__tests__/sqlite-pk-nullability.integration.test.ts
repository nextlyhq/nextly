/**
 * Primary keys must not read as a pending NOT NULL change.
 *
 * SQLite reports a `TEXT PRIMARY KEY` column as nullable, because only
 * INTEGER PRIMARY KEY (the rowid alias) is implicitly NOT NULL. Drizzle's
 * `.primaryKey()` carries no such quirk and means NOT NULL, so taking SQLite's
 * storage answer literally makes every primary key look like a NOT NULL
 * addition. The classifier treats that as destructive, which refuses the whole
 * core reconcile on a database nobody has changed — and `nextly migrate` is
 * the documented way out of a schema that is behind the code, so refusing here
 * removes the only recovery path.
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

describe("sqlite primary key nullability", () => {
  it("reports a primary key as NOT NULL", async () => {
    current = await createTestNextly({});
    const live = await introspectLiveSnapshot(
      current.adapter.getDrizzle(),
      "sqlite",
      ["nextly_events"]
    );

    const id = live.tables
      .find(t => t.name === "nextly_events")
      ?.columns.find(c => c.name === "id");

    expect(id?.nullable).toBe(false);
  });

  it("still reports an ordinary nullable column as nullable", async () => {
    // The fix must not blanket-mark columns NOT NULL; only primary keys.
    current = await createTestNextly({});
    const live = await introspectLiveSnapshot(
      current.adapter.getDrizzle(),
      "sqlite",
      ["nextly_events"]
    );

    const optional = live.tables
      .find(t => t.name === "nextly_events")
      ?.columns.find(c => c.name === "actor_id");

    expect(optional?.nullable).toBe(true);
  });
});
