import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { batchCursorKey, writeBatchCursor } from "../batch-cursor";
import { MIGRATION_TARGET } from "../manifest";
import { rewriteContentKey } from "../rewrite-content-key";
import {
  findUnrewrittenRow,
  rewriteRowsInBatches,
  type RowRewriteTarget,
} from "../rewrite-rows";

import {
  createTableWorld,
  type TableWorldOptions,
} from "./helpers/table-world";

const RUN = "run-1";
const STEP = "data:nextly_versions.snapshot";
const TARGET: RowRewriteTarget = {
  table: "nextly_versions",
  documentProperty: "snapshot",
};

/** The real rewrite, so these tests exercise what the step will actually run. */
const rewrite = (document: unknown): unknown =>
  rewriteContentKey(
    document,
    STORAGE_FORMAT.wireTypeKey,
    MIGRATION_TARGET.wireTypeKey
  );

/** Ids are zero-padded so the keyset walk's ordering is unambiguous. */
function id(index: number): string {
  return `row-${String(index).padStart(3, "0")}`;
}

/** More rows than one batch holds, so the walk has to page. */
const ROW_COUNT = 250;

function versionsWorld(options: TableWorldOptions = {}) {
  return createTableWorld(
    {
      nextly_versions: {
        columns: ["id", "snapshot"],
        rows: Array.from({ length: ROW_COUNT }, (_unused, index) => ({
          id: id(index),
          snapshot: { _componentType: "hero", n: index },
        })),
      },
    },
    options
  );
}

function run(world: ReturnType<typeof versionsWorld>): Promise<void> {
  return rewriteRowsInBatches({
    session: world.session,
    meta: world.meta,
    migrationId: RUN,
    stepId: STEP,
    target: TARGET,
    rewrite,
  });
}

describe("rewriting a ledger's documents in batches", () => {
  it("reaches every row across more than one batch", async () => {
    const world = versionsWorld();
    await run(world);

    const rows = world.rows("nextly_versions");
    expect(rows).toHaveLength(ROW_COUNT);
    for (const row of rows) {
      expect(row.snapshot).not.toHaveProperty("_componentType");
      expect(row.snapshot).toHaveProperty("_fieldGroupType", "hero");
    }
    // More than one transaction, or the batching is not batching.
    expect(world.counts.transactions).toBeGreaterThan(1);
  });

  it("leaves rows that need nothing alone instead of rewriting them to themselves", async () => {
    const world = createTableWorld({
      nextly_versions: {
        columns: ["id", "snapshot"],
        rows: [
          { id: id(0), snapshot: { _fieldGroupType: "hero" } },
          { id: id(1), snapshot: { _componentType: "cta" } },
          { id: id(2), snapshot: { title: "plain" } },
        ],
      },
    });
    await run(world);
    // Exactly the one row that carried the old key.
    expect(world.counts.updates).toBe(1);
  });

  it("is idempotent: a second pass writes nothing", async () => {
    const world = versionsWorld();
    await run(world);
    const after = world.counts.updates;
    await run(world);
    expect(world.counts.updates).toBe(after);
  });

  it("records a position as it goes, and clears it when the table is done", async () => {
    const world = versionsWorld();
    await run(world);
    expect(world.metaValue(batchCursorKey(STEP))).toBeUndefined();
  });

  // 🔴 The reason a position is worth recording: a resumed run must not re-read
  // the whole ledger. Proven by leaving a row BEFORE the cursor still carrying
  // the old key — a walk that ignored the cursor would rewrite it.
  it("resumes from a recorded position rather than from the start", async () => {
    const world = versionsWorld();
    await writeBatchCursor(world.meta, {
      migrationId: RUN,
      stepId: STEP,
      after: id(199),
    });
    await run(world);

    const rows = world.rows("nextly_versions");
    expect(rows[0]?.snapshot).toHaveProperty("_componentType");
    expect(rows[ROW_COUNT - 1]?.snapshot).toHaveProperty("_fieldGroupType");
  });

  // 🔴 The cursor may lag and may never lead. A batch that fails rolls back, and
  // the position must still name the last batch that actually committed —
  // otherwise the next run steps over rows nothing rewrote.
  it("does not advance the position past a batch that failed", async () => {
    const world = versionsWorld({
      onUpdate: (_table, rowId) => {
        if (rowId === id(210)) throw new Error("statement refused");
      },
    });

    await expect(run(world)).rejects.toThrow("statement refused");

    expect(world.metaValue(batchCursorKey(STEP))).toEqual({
      migrationId: RUN,
      after: id(199),
    });
    // The failed batch left nothing behind either.
    expect(world.rows("nextly_versions")[205]?.snapshot).toHaveProperty(
      "_componentType"
    );
  });

  it("finishes a run that a previous one left part-way", async () => {
    const failing = versionsWorld({
      onUpdate: (_table, rowId) => {
        if (rowId === id(210)) throw new Error("statement refused");
      },
    });
    await expect(run(failing)).rejects.toThrow("statement refused");

    // Same world, no longer failing: a resume picks up from the recorded
    // position and finishes the tail.
    const resumed = createTableWorld({
      nextly_versions: {
        columns: ["id", "snapshot"],
        rows: failing.rows("nextly_versions"),
      },
    });
    await resumed.meta.set(batchCursorKey(STEP), {
      migrationId: RUN,
      after: id(199),
    });
    await run(resumed);

    await expect(
      findUnrewrittenRow({ session: resumed.session, target: TARGET, rewrite })
    ).resolves.toBeUndefined();
  });
});

describe("checking that a batched rewrite reached everything", () => {
  it("reports nothing outstanding once the walk has run", async () => {
    const world = versionsWorld();
    await run(world);
    await expect(
      findUnrewrittenRow({ session: world.session, target: TARGET, rewrite })
    ).resolves.toBeUndefined();
  });

  // 🔴 This is what makes the cursor an optimisation instead of a correctness
  // mechanism. The walk has run to the end of the table and reported success;
  // a row it did not cover must still be found, by rescanning rather than by
  // trusting where the batches got to.
  it("finds a row the walk never covered", async () => {
    const world = versionsWorld();
    await run(world);
    world.insert("nextly_versions", {
      id: id(999),
      snapshot: { _componentType: "late" },
    });

    await expect(
      findUnrewrittenRow({ session: world.session, target: TARGET, rewrite })
    ).resolves.toBe(id(999));
  });

  it("looks past the first batch to find one", async () => {
    const world = versionsWorld();
    await run(world);
    const rows = world.rows("nextly_versions");
    const straggler = rows[ROW_COUNT - 1];
    if (straggler === undefined) throw new Error("fixture has no rows");
    straggler.snapshot = { _componentType: "missed" };

    await expect(
      findUnrewrittenRow({ session: world.session, target: TARGET, rewrite })
    ).resolves.toBe(id(ROW_COUNT - 1));
  });
});

describe("refusing a target this cannot rewrite honestly", () => {
  // 🔴 A projection naming a property the table does not have comes back
  // without the key. `rewrite(undefined)` returns `undefined`, so the walk
  // writes nothing — and the postcondition, reading the same absent property,
  // agrees there is nothing left to do. A silent no-op reporting success is the
  // one outcome a data migration must not have.
  it("refuses a document property the table does not carry", async () => {
    const world = createTableWorld({
      nextly_versions: {
        columns: ["id", "payload"],
        rows: [{ id: id(0), payload: { _componentType: "hero" } }],
      },
    });

    await expect(run(world)).rejects.toMatchObject({
      logContext: {
        reason: "row rewrite target names a property the table does not have",
        property: "snapshot",
      },
    });
  });

  it("refuses the same way when checking the postcondition", async () => {
    const world = createTableWorld({
      nextly_versions: {
        columns: ["id", "payload"],
        rows: [{ id: id(0), payload: { _componentType: "hero" } }],
      },
    });

    await expect(
      findUnrewrittenRow({ session: world.session, target: TARGET, rewrite })
    ).rejects.toMatchObject({
      logContext: {
        reason: "row rewrite target names a property the table does not have",
      },
    });
  });

  // The walk orders by this value, carries it in the cursor, and addresses every
  // write with it, so an id it cannot compare is not something to guess at.
  it("refuses a primary key that is not a non-empty string", async () => {
    const world = createTableWorld({
      nextly_versions: {
        columns: ["id", "snapshot"],
        rows: [{ id: 7, snapshot: { _componentType: "hero" } }],
      },
    });

    await expect(run(world)).rejects.toMatchObject({
      logContext: {
        reason: "row rewrite requires a non-empty string primary key",
        table: "nextly_versions",
      },
    });
  });
});
