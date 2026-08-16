/**
 * The version-conditional registry write, proved against real databases.
 *
 * ## Why this cannot be a unit test
 *
 * The whole mechanism is a claim about what the DATABASE does with a statement, and the three
 * dialects answer differently in a way no double can reproduce faithfully:
 *
 * - PostgreSQL reports `rowCount`, MySQL reports `affectedRows`, SQLite reports `changes`, and
 *   `DrizzleAdapter.updateCount` reads whichever the driver hands it;
 * - 🔴 **MySQL counts CHANGED rows, not MATCHED rows.** An UPDATE whose WHERE matches a row but
 *   whose SET writes values identical to the ones already stored reports ZERO. That is the exact
 *   shape a compare-and-set takes, so on MySQL "matched" and "changed" have to be made the same
 *   thing — the conditional write always advances `schema_version`, which is what guarantees it.
 *
 * A mock returning a number proves the code's arithmetic and nothing about the semantics the
 * arithmetic depends on. These assert the semantics.
 *
 * ## What each case separates
 *
 * The property under test is not "the write happened" — an unconditional write satisfies that too.
 * It is that the write happens EXACTLY when the row is still at the expected version, so each case
 * below pairs an outcome with the assertion that the row did or did not move.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set, and each dialect gets its own throwaway database.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const FIELDS = [
  { name: "heading", type: "text" },
  { name: "weight", type: "number" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`the version-conditional registry write — ${dialect}`, () => {
    const slug = `fgcw_${dialect.slice(0, 2)}`;

    /** A created field group and the registry service that owns it. */
    async function seed() {
      current = await createTestNextly({ dialect });
      const registry = current.getService("fieldGroupRegistryService");
      await current.nextly.fieldGroups.create({
        slug,
        label: "Conditional write",
        fields: FIELDS,
      });
      const row = await registry.getComponent(slug);
      return { registry, row };
    }

    it("writes and advances the version when the row is at the expected version", async () => {
      const { registry, row } = await seed();

      const outcome = await registry.updateComponentIfVersion(
        slug,
        { migrationStatus: "diverged" },
        row.schemaVersion
      );

      expect(outcome).toEqual({
        matched: true,
        newSchemaVersion: row.schemaVersion + 1,
      });
      // The write is real, not merely reported: read it back through the registry.
      const after = await registry.getComponent(slug);
      expect(after.migrationStatus).toBe("diverged");
      expect(after.schemaVersion).toBe(row.schemaVersion + 1);
    });

    it("refuses, and writes nothing, when the row has moved past that version", async () => {
      const { registry, row } = await seed();

      // Someone else's write lands first, advancing the version.
      await registry.updateComponentIfVersion(
        slug,
        { label: "Moved by another writer" },
        row.schemaVersion
      );

      const outcome = await registry.updateComponentIfVersion(
        slug,
        { migrationStatus: "diverged" },
        // The version this caller decided from, now stale.
        row.schemaVersion
      );

      expect(outcome).toEqual({ matched: false });
      // 🔴 The refusal has to be observable in the ROW, not only in the return value: an
      // implementation that reported `matched: false` while still writing would satisfy the
      // assertion above and be exactly the overwrite this mechanism exists to prevent.
      const after = await registry.getComponent(slug);
      expect(after.migrationStatus).not.toBe("diverged");
      expect(after.label).toBe("Moved by another writer");
      expect(after.schemaVersion).toBe(row.schemaVersion + 1);
    });

    // 🔴 The dialect-specific case, and the one a double cannot reproduce: every AUTHORED column
    // this write SETs already holds the value being written, so MySQL's changed-row count for the
    // caller's data alone is zero. It still reports matched.
    //
    // What this establishes, precisely: an all-identical payload is not mistaken for an unmatched
    // row on any of the three dialects. What it does NOT establish is WHICH always-moving column
    // supplies that, because two of them move together — `schema_version` and `updated_at`. A
    // break-control removing the version bump alone still passes the matched assertion here and
    // fails only the version one, which is how the pairing was found rather than assumed. The
    // version is the one the code relies on, because it is strictly monotonic while two writes in
    // one timestamp tick share an `updated_at`; that narrower property has no test, because
    // forcing a tick collision from here would be testing the clock.
    it("reports matched even when every written value is identical to the stored one", async () => {
      const { registry, row } = await seed();

      const outcome = await registry.updateComponentIfVersion(
        slug,
        // `label` is what the row already carries, so nothing but the version can move.
        { label: row.label },
        row.schemaVersion
      );

      expect(outcome).toEqual({
        matched: true,
        newSchemaVersion: row.schemaVersion + 1,
      });
      const after = await registry.getComponent(slug);
      expect(after.schemaVersion).toBe(row.schemaVersion + 1);
    });

    it("refuses every concurrent writer but one at the same expected version", async () => {
      const { registry, row } = await seed();

      // Three callers that each decided from the same version, issued together. Exactly one may
      // win: this is the property the whole mechanism exists for, and a read-then-write
      // implementation lets all three through.
      const outcomes = await Promise.all([
        registry.updateComponentIfVersion(
          slug,
          { label: "writer-a" },
          row.schemaVersion
        ),
        registry.updateComponentIfVersion(
          slug,
          { label: "writer-b" },
          row.schemaVersion
        ),
        registry.updateComponentIfVersion(
          slug,
          { label: "writer-c" },
          row.schemaVersion
        ),
      ]);

      expect(outcomes.filter(o => o.matched)).toHaveLength(1);
      const after = await registry.getComponent(slug);
      expect(after.schemaVersion).toBe(row.schemaVersion + 1);
      // The surviving label belongs to whichever writer won — asserted as membership rather than
      // a fixed name, because which one wins is the database's to decide and pinning it would
      // make this a test of scheduling.
      expect(["writer-a", "writer-b", "writer-c"]).toContain(after.label);
    });
  });
}
