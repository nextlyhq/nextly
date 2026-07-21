/**
 * Push-then-diff round trip on the core schema.
 *
 * A database Nextly has just created must not report type changes against the
 * definition it was created from. When it does, `nextly migrate` classifies
 * them as destructive and refuses the whole reconcile, which is how a single
 * mis-rendered column type made core reconcile unusable on every PostgreSQL
 * install — including a database created seconds earlier.
 *
 * Scoped to type changes on purpose. Default rendering does not round-trip
 * yet (SQL-expression defaults serialise as objects, and PostgreSQL echoes
 * casts back), so a blanket zero-ops assertion would encode today's noise as
 * expected rather than pinning the invariant that matters.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../../../../schemas/index";
import { diffSnapshots } from "../diff";
import { introspectLiveSnapshot } from "../introspect-live";

const URL = process.env.TEST_POSTGRES_URL ?? "";

// Dialect gate: skipped when the dialect's URL is unset, matching the other
// dialect gates in this package.
const describePg = describe.skipIf(!URL);

describePg("core schema round trip (postgres)", () => {
  let handle: TestNextly | undefined;

  beforeAll(async () => {
    if (!URL) return;
    // env.ts validates DATABASE_URL against DB_DIALECT on first read and
    // caches it, so both must be set before the adapter is built.
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = URL;
    const adapter = await createAdapter({
      type: "postgresql",
      url: URL,
    } as Parameters<typeof createAdapter>[0]);
    handle = await createTestNextly({ adapter });
  });

  afterAll(async () => {
    await handle?.destroy();
  });

  it("reports no type change against the schema it was created from", async () => {
    const live = await introspectLiveSnapshot(
      handle!.adapter.getDrizzle(),
      "postgresql",
      [...CORE_TABLE_NAMES]
    );
    const ops = diffSnapshots(live, getCoreSchema("postgresql"));

    const typeChanges = ops.filter(o => o.type === "change_column_type");
    expect(typeChanges).toEqual([]);
  });

  it("keeps an array column comparable in both directions", async () => {
    // media.tags is `text("tags").array()`; PostgreSQL reports `_text`. This
    // is the column whose mismatch refused every core reconcile.
    const live = await introspectLiveSnapshot(
      handle!.adapter.getDrizzle(),
      "postgresql",
      ["media"]
    );
    const liveTags = live.tables
      .find(t => t.name === "media")
      ?.columns.find(c => c.name === "tags");
    const desiredTags = getCoreSchema("postgresql")
      .tables.find(t => t.name === "media")
      ?.columns.find(c => c.name === "tags");

    expect(liveTags?.type).toBe("_text");
    expect(desiredTags?.type).toBe("text[]");
    expect(
      diffSnapshots(live, getCoreSchema("postgresql")).filter(
        o => o.type === "change_column_type"
      )
    ).toEqual([]);
  });
});
