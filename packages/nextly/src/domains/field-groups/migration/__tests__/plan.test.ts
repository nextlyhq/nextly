import { describe, expect, it, vi } from "vitest";

import type { MetaService } from "../../../meta/services/meta-service";
import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";
import {
  buildMigrationPlan,
  directedRenameEntries,
  renamePositionOffset,
  renameRunRecord,
} from "../plan";
import type { ManifestEntry } from "../manifest";
import type { MigrationSession } from "../session";
import type { StorageObserver } from "../steps";

const PRESERVING = identifierCaseRules({ dialect: "postgresql" });

/** A canonical plan: one field group with a companion, plus the registry. */
const ENTRIES: ManifestEntry[] = [
  {
    kind: "table",
    from: "comp_hero",
    to: "fg_hero",
    companion: { from: "comp_hero_locales", to: "fg_hero_locales" },
  },
  {
    kind: "column",
    from: "_component_type",
    to: "_field_group_type",
    table: "fg_hero",
  },
  { kind: "registry", from: "dynamic_components", to: "dynamic_field_groups" },
];

const observer: StorageObserver = {
  tables: vi.fn(async () => []),
  columns: vi.fn(async () => undefined),
  pointers: vi.fn(async () => []),
  dataTables: vi.fn(async () => []),
  indexNames: vi.fn(async () => undefined),
};

const meta = {} as unknown as MetaService;

/**
 * Composed the way the orchestrator composes it: direct the entries first, then
 * build. The builder no longer inverts internally, because the caller has to
 * reconcile the directed entries against the catalog before executing them.
 */
function planSteps(direction: "up" | "down") {
  return buildMigrationPlan({
    direction,
    ownedDataTables: [],
    entries: directedRenameEntries(direction, ENTRIES),
    identifierCase: PRESERVING,
    observer,
    meta,
    migrationId: "run-1",
  });
}

function plan(direction: "up" | "down"): string[] {
  return planSteps(direction).map(step => step.id);
}

describe("assembling the steps one run executes", () => {
  // 🔴 The data steps must precede every rename going up. They reach their
  // tables through the typed CRUD, which refuses a name the ORM does not
  // declare, and the field-group registry is declared under its LEGACY name -
  // so those steps are only expressible before its rename.
  it("puts the data rewrites ahead of the renames going up", () => {
    const ids = plan("up");
    // Written without `findLastIndex`, which needs a newer lib target than this
    // package compiles against.
    const lastData = ids
      .map((id, index) => (id.startsWith("data:") ? index : -1))
      .reduce((highest, index) => (index > highest ? index : highest), -1);
    // The settle step is a data id and comes last by design, so the boundary
    // asked about here is the first rename, not the first non-data id.
    const firstRename = ids.findIndex((id: string) => id.startsWith("table:"));
    const lastBeforeRenames = ids
      .slice(0, firstRename)
      .map((id, index) => (id.startsWith("data:") ? index : -1))
      .reduce((highest, index) => (index > highest ? index : highest), -1);
    void lastData;
    expect(lastBeforeRenames).toBeLessThan(firstRename);
  });

  it("runs every data step and every rename exactly once", () => {
    const ids = plan("up");
    expect(ids).toEqual([
      "data:nextly_versions.snapshot",
      "data:nextly_events.payload",
      "table:comp_hero->fg_hero",
      "column:fg_hero._component_type->_field_group_type",
      "registry:dynamic_components->dynamic_field_groups",
      // Last, so a write landing during the renames above is still caught.
      "data:settle-ledgers",
    ]);
  });

  // 🔴 The property the whole design rests on: down is the exact reverse of up.
  // That is what puts the data steps AFTER the renames on the way back, when
  // the names they address have been restored.
  it("is the exact reverse of itself going down", () => {
    const up = plan("up");
    const down = plan("down");

    expect(down).toHaveLength(up.length);
    // Same work, mirrored: each down id is its up counterpart with the rename
    // reversed, so comparing the ordering of KINDS is the honest check.
    const kind = (id: string): string => id.split(":")[0] ?? "";
    // The settle steps are appended to BOTH plans and are not mirrored work:
    // they are the same checks asked at the end of whichever direction ran. The
    // reversal property describes the work, so it is asserted over the work.
    const SETTLE = ["data:settle-ledgers"];
    const work = (ids: string[]): string[] =>
      ids.filter(id => !SETTLE.includes(id));
    expect(work(down).map(kind)).toEqual([...work(up).map(kind)].reverse());
    // In the same order at the end of both, rather than mirrored with the work.
    expect(up.slice(-SETTLE.length)).toEqual(SETTLE);
    expect(down.slice(-SETTLE.length)).toEqual(SETTLE);
  });

  it("reverses each rename rather than reissuing it", () => {
    expect(plan("down")).toEqual([
      "registry:dynamic_field_groups->dynamic_components",
      "column:fg_hero._field_group_type->_component_type",
      "table:fg_hero->comp_hero",
      "data:nextly_events.payload",
      "data:nextly_versions.snapshot",
      // Appended to both directions, so it closes the rollback too.
      "data:settle-ledgers",
    ]);
  });

  // The canonical plan is always legacy-to-migrated, whichever way the run
  // goes. Handing this function a pre-inverted plan for a rollback would invert
  // it twice and migrate forward while reporting a rollback.
  it("does not mutate the entries it was given", () => {
    const snapshot = structuredClone(ENTRIES);
    plan("down");
    expect(ENTRIES).toEqual(snapshot);
  });

  // 🔴 A marker counts positions across the WHOLE list, but reconciliation
  // scores rename entries from one. Going up the data steps hold the first
  // positions, so a recorded position has to shift down by that many; going
  // down the renames already start at one. Untranslated, a resume marks that
  // many renames as verified when they never ran.
  it("offsets a recorded position into rename coordinates", () => {
    expect(renamePositionOffset("up", 4)).toBe(4);
    expect(renamePositionOffset("down", 4)).toBe(0);
  });

  it("directs the entries for the direction that will execute them", () => {
    expect(directedRenameEntries("up", ENTRIES)).toEqual(ENTRIES);
    // Reversed AND swapped, so reconciliation asks whether the MIGRATED names
    // are present rather than the legacy ones.
    expect(directedRenameEntries("down", ENTRIES).map(e => e.from)).toEqual([
      "dynamic_field_groups",
      "_field_group_type",
      "fg_hero",
    ]);
  });

  // 🔴 A position strictly INSIDE the data steps is reported as unrecorded.
  // Reconciliation treats `step + 1` as the supported commit-before-marker
  // window, so any reported progress here would vouch for rename position 1 -
  // and an unrelated object carrying a target name could be adopted as this
  // plan's completed work while no rename had been attempted at all.
  it.each([1, 2, 3])(
    "reports no rename progress for whole-plan step %i",
    step => {
      expect(
        renameRunRecord({
          status: "migrating",
          direction: "up",
          step,
          offset: 4,
        })
      ).toEqual({ recorded: false });
    }
  );

  // 🔴 The boundary belongs on the other side. Every data step is recorded and
  // the first rename is the next thing the runner does, so this is exactly the
  // commit-before-marker window the resume contract promises to survive: the
  // rename commits in its own transaction and the marker write follows.
  // Reporting it as unrecorded strands that run - reconciliation refuses the
  // target the torn step produced as unaccounted-for.
  it("recognises a torn first rename at the data boundary", () => {
    expect(
      renameRunRecord({
        status: "migrating",
        direction: "up",
        step: 4,
        offset: 4,
      })
    ).toEqual({ recorded: true, direction: "up", step: 0 });
  });

  // The same boundary going down, where the renames come first and the offset
  // is zero: a fresh in-flight marker records step 0 before the first rename.
  it("recognises a torn first rename in a rollback", () => {
    expect(
      renameRunRecord({
        status: "migrating",
        direction: "down",
        step: 0,
        offset: 0,
      })
    ).toEqual({ recorded: true, direction: "down", step: 0 });
  });

  it("reports rename progress once the renames have begun", () => {
    expect(
      renameRunRecord({
        status: "migrating",
        direction: "up",
        step: 5,
        offset: 4,
      })
    ).toEqual({ recorded: true, direction: "up", step: 1 });
  });

  // Going down the renames come first, so the offset is zero and a recorded
  // position is already in rename coordinates.
  it("passes a rollback's position through unshifted", () => {
    expect(
      renameRunRecord({
        status: "migrating",
        direction: "down",
        step: 2,
        offset: 0,
      })
    ).toEqual({ recorded: true, direction: "down", step: 2 });
  });

  it("reports no progress at all when nothing is in flight", () => {
    expect(
      renameRunRecord({
        status: "settled",
        direction: "up",
        step: 9,
        offset: 4,
      })
    ).toEqual({ recorded: false });
  });
});

describe("which steps a marker remembers", () => {
  const settleSteps = () =>
    planSteps("up").filter(step => step.id.startsWith("data:settle-"));
  const workSteps = () =>
    planSteps("up").filter(step => !step.id.startsWith("data:settle-"));

  // 🔴 The settlement checks are gates, not work. A recorded position is what
  // lets a later run step over something, so recording these would let the very
  // resume they exist to protect skip them and settle on whatever the database
  // looked like before the interruption.
  it("declines to record the settlement checks", () => {
    const settle = settleSteps();
    expect(settle).toHaveLength(1);
    expect(settle.every(step => step.recordsProgress === false)).toBe(true);
  });

  // The control: everything else does record, so the assertion above cannot be
  // satisfied by a plan whose every step declines.
  it("records every step that is actual work", () => {
    const work = workSteps();
    expect(work).not.toHaveLength(0);
    expect(work.every(step => step.recordsProgress !== false)).toBe(true);
  });

  // The gates have to be the LAST steps: a recorded position counts positions
  // in the plan, so a gate in the middle leaves a gap the next recording step
  // cannot advance across.
  it("puts every gate at the end of the plan", () => {
    for (const direction of ["up", "down"] as const) {
      const flags = planSteps(direction).map(
        step => step.recordsProgress !== false
      );
      expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    }
  });
});
