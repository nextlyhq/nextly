import { describe, expect, it } from "vitest";

import {
  batchCursorKey,
  clearBatchCursor,
  readBatchCursor,
  writeBatchCursor,
} from "../batch-cursor";

import { createTableWorld } from "./helpers/table-world";

const RUN = "run-1";
const STEP = "data:nextly_versions.snapshot";

function world() {
  return createTableWorld({});
}

describe("the batched rewrite's durable position", () => {
  it("round-trips a position for the run that wrote it", async () => {
    const { meta } = world();
    await writeBatchCursor(meta, {
      migrationId: RUN,
      stepId: STEP,
      after: "row-9",
    });
    await expect(
      readBatchCursor(meta, { migrationId: RUN, stepId: STEP })
    ).resolves.toBe("row-9");
  });

  it("reports no position when nothing was ever written", async () => {
    const { meta } = world();
    await expect(
      readBatchCursor(meta, { migrationId: RUN, stepId: STEP })
    ).resolves.toBeNull();
  });

  // 🔴 The load-bearing rule. A position means "everything at or before this id
  // is done" only for the run that established it: a cursor from any other run
  // — most of all one travelling the other way, whose position means the
  // opposite — would step this run past rows nothing rewrote.
  it("ignores a position left by a different run", async () => {
    const { meta } = world();
    await writeBatchCursor(meta, {
      migrationId: "some-other-run",
      stepId: STEP,
      after: "row-9",
    });
    await expect(
      readBatchCursor(meta, { migrationId: RUN, stepId: STEP })
    ).resolves.toBeNull();
  });

  // Each step walks its own table, so a position is meaningless anywhere else.
  it("keeps each step's position under its own key", async () => {
    const { meta } = world();
    await writeBatchCursor(meta, {
      migrationId: RUN,
      stepId: "data:nextly_events.payload",
      after: "row-9",
    });
    await expect(
      readBatchCursor(meta, { migrationId: RUN, stepId: STEP })
    ).resolves.toBeNull();
  });

  // Unlike the migration marker, which refuses when it cannot be read. Starting
  // a batch walk over is always correct, so a cursor that does not decode costs
  // a second pass rather than stranding the run.
  it.each([
    ["not an object", "row-9"],
    ["null", null],
    ["missing a position", { migrationId: RUN }],
    ["holding an empty position", { migrationId: RUN, after: "" }],
    ["holding a non-string position", { migrationId: RUN, after: 9 }],
  ])("starts over on a stored value %s", async (_label, stored) => {
    const { meta } = world();
    await meta.set(batchCursorKey(STEP), stored);
    await expect(
      readBatchCursor(meta, { migrationId: RUN, stepId: STEP })
    ).resolves.toBeNull();
  });

  it("leaves nothing behind once a step has finished", async () => {
    const { meta, metaValue } = world();
    await writeBatchCursor(meta, {
      migrationId: RUN,
      stepId: STEP,
      after: "row-9",
    });
    await clearBatchCursor(meta, { stepId: STEP });
    expect(metaValue(batchCursorKey(STEP))).toBeUndefined();
  });

  it("namespaces its key beneath the migration's own marker", () => {
    expect(batchCursorKey(STEP)).toBe(
      "field_groups.storage_migration.cursor.data:nextly_versions.snapshot"
    );
  });
});
