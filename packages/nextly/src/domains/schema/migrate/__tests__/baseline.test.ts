/**
 * Adopting a database that already exists.
 *
 * The decisions are tested without a database on purpose: each one is a
 * judgement about two snapshots, and the refusals are the part that has to be
 * right. Baselining twice would give a history two starting points, and
 * baselining nothing would record an origin that describes no schema.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";
import { isUnadoptedDatabase, planBaseline } from "../baseline";
import { migrationDriftError } from "../drift-error";

const table = (name: string): NextlySchemaSnapshot["tables"][number] =>
  ({
    name,
    columns: [{ name: "id", type: "text", notNull: true, primaryKey: true }],
    indexes: [],
  }) as unknown as NextlySchemaSnapshot["tables"][number];

const snapshot = (...names: string[]): NextlySchemaSnapshot => ({
  tables: names.map(table),
});

describe("planBaseline", () => {
  it("plans the live schema as the starting point", () => {
    const live = snapshot("dc_posts", "dc_tags");

    const plan = planBaseline({ live });

    expect(plan.kind).toBe("baseline");
    if (plan.kind !== "baseline") throw new Error("expected a baseline plan");
    // The recorded snapshot IS the live one: later diffs are measured from
    // what the database has, not from what the config happens to say today.
    expect(plan.snapshot).toEqual(live);
    // And the body builds that schema from nothing, which is what lets a
    // different database be built from this history.
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations.every(op => op.type === "add_table")).toBe(true);
  });

  it("refuses when a history already has a starting point", () => {
    // Not an error the operator has to recover from, but not a no-op either:
    // writing a second baseline would leave two origins in one history, and
    // every later diff would depend on which one it read.
    const plan = planBaseline({
      live: snapshot("dc_posts"),
      latestSnapshotName: "20260101000000_init.snapshot.json",
    });

    expect(plan).toEqual({
      kind: "already-baselined",
      snapshotName: "20260101000000_init.snapshot.json",
    });
  });

  it("refuses an empty database rather than recording an empty origin", () => {
    // A project with no tables has nothing to adopt; its first migration is a
    // normal one. Recording an empty baseline would be indistinguishable from
    // having no baseline at all, while silently consuming the one chance to
    // take a real one.
    expect(planBaseline({ live: snapshot() })).toEqual({
      kind: "empty-database",
    });
  });

  it("refuses a history whose files carry no snapshot", () => {
    // `migrate:create --blank` writes hand-authored SQL with no snapshot
    // beside it, so the snapshot check alone reads such a project as never
    // baselined. Appending an origin after those files means a fresh database
    // replays them against tables the baseline has not created yet.
    expect(
      planBaseline({
        live: snapshot("dc_posts"),
        existingMigrationFile: "20260101000000_custom.sql",
      })
    ).toEqual({
      kind: "history-not-empty",
      filename: "20260101000000_custom.sql",
    });
  });

  it("names the origin rather than the files when both are present", () => {
    // An ordinary migrated project has both. The snapshot is the more useful
    // thing to name, because it is what the operator can point at to see the
    // history really does have a starting point.
    const plan = planBaseline({
      live: snapshot("dc_posts"),
      latestSnapshotName: "20260101000000_init.snapshot.json",
      existingMigrationFile: "20260101000000_init.sql",
    });

    expect(plan.kind).toBe("already-baselined");
  });

  it("refuses a snapshot-less history even on an empty database", () => {
    // Both refusals apply; the files are the damaging one. Reporting "nothing
    // to adopt" would send the operator to `migrate:create`, appending yet
    // another file to a history that still has no origin.
    expect(
      planBaseline({
        live: snapshot(),
        existingMigrationFile: "20260101000000_custom.sql",
      }).kind
    ).toBe("history-not-empty");
  });

  it("prefers the already-baselined answer over the empty one", () => {
    // Both conditions can hold at once — a migrated project whose database has
    // been dropped. The history is the fact that matters: writing a second
    // origin is the damaging outcome, and it is the one to refuse.
    const plan = planBaseline({
      live: snapshot(),
      latestSnapshotName: "20260101000000_init.snapshot.json",
    });

    expect(plan.kind).toBe("already-baselined");
  });
});

describe("isUnadoptedDatabase", () => {
  it("recognises tables standing before the history started", () => {
    expect(
      isUnadoptedDatabase({
        before: snapshot(),
        driftKinds: ["+", "+", "+"],
      })
    ).toBe(true);
  });

  it("does not claim a migrated project is unadopted", () => {
    // Drift against a real baseline is ordinary drift, whichever direction it
    // runs in. Sending that operator to baseline would be sending them at a
    // command that refuses.
    expect(
      isUnadoptedDatabase({
        before: snapshot("dc_posts"),
        driftKinds: ["+"],
      })
    ).toBe(false);
  });

  it("does not claim a half-applied migration is unadopted", () => {
    // A failed run leaves differences in BOTH directions. Only a database that
    // is entirely ahead of an empty baseline has never been adopted.
    expect(
      isUnadoptedDatabase({
        before: snapshot(),
        driftKinds: ["+", "-"],
      })
    ).toBe(false);
  });

  it("needs at least one difference to call anything unadopted", () => {
    // No drift means this function was never reached in practice; answering
    // true on an empty list would make the guidance appear for a state that
    // does not exist.
    expect(isUnadoptedDatabase({ before: snapshot(), driftKinds: [] })).toBe(
      false
    );
  });
});

describe("the drift error an unadopted database produces", () => {
  it("names the cause and offers the one command that works", () => {
    // The three generic recoveries all fail here: `db:sync` reports no
    // changes, `migrate:resolve --applied` refuses because live does not equal
    // the target, and `migrate:create` detects nothing. Offering them costs
    // three attempts before the real answer.
    const error = migrationDriftError({
      migration: "20260805120000_add_localization",
      file: "migrations/20260805120000_add_localization.sql",
      driftItems: [{ kind: "+", detail: "table 'dc_posts' present in DB" }],
      unadoptedDatabase: true,
    });

    expect(error.publicMessage).toContain("migrate:baseline");
    expect(error.publicMessage).toContain("already has tables");
    // The menu is gone, not merely reordered.
    expect(error.publicMessage).not.toContain("[A]");
    expect(error.publicMessage).not.toContain("migrate:resolve --applied");
    // The recovery names BOTH files, and removes them BEFORE baselining.
    // This migration was written with a snapshot beside it, and
    // `migrate:baseline` refuses a project that has one — so baselining first
    // reports "already baselined" and the documented recovery cannot work.
    // Deleting only the `.sql` leaves the snapshot to do the same thing.
    expect(error.publicMessage).toContain(
      "migrations/20260805120000_add_localization.sql"
    );
    expect(error.publicMessage).toContain(
      join(
        "migrations",
        "meta",
        "20260805120000_add_localization.snapshot.json"
      )
    );
    const removeAt = error.publicMessage.indexOf("rm ");
    const baselineAt = error.publicMessage.indexOf("migrate:baseline");
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeLessThan(baselineAt);
  });

  it("keeps the generic recoveries for real drift", () => {
    const error = migrationDriftError({
      migration: "20260805120000_add_field",
      file: "migrations/20260805120000_add_field.sql",
      driftItems: [{ kind: "-", detail: "table 'dc_posts' absent from DB" }],
    });

    expect(error.publicMessage).toContain("[A]");
    expect(error.publicMessage).toContain("[C]");
    // Sending an operator whose migration half-applied to `baseline` would be
    // sending them at a command that refuses.
    expect(error.publicMessage).not.toContain("migrate:baseline");
  });
});
