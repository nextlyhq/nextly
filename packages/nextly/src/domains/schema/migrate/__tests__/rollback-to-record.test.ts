/**
 * What a rollback makes of the point it leaves the database at, once the
 * registry record exists, and which orphan marks a rollback to the record's
 * point sets and clears (`rollback-to-record.ts`).
 */
import { describe, expect, it } from "vitest";

import type { OrphanPassRow } from "../../../auth/services/permission-seed-service";
import type { AppMigrationStanding } from "../first-run";
import type { RegistryBaseline } from "../registry-record";
import {
  judgeRollbackPoint,
  orphanMarksUndone,
  type RolledBackMigration,
} from "../rollback-to-record";

/** An applied migration, with what its snapshot says of the registry. */
function m(
  name: string,
  metadata: AppMigrationStanding["metadata"]
): AppMigrationStanding {
  return { name, applied: true, metadata };
}

const BASELINE: RegistryBaseline = {
  collections: {},
  singles: {},
  fieldGroups: {},
  permissions: ["read-users"],
};

describe("judgeRollbackPoint", () => {
  it("has nothing to do before the record exists", () => {
    expect(
      judgeRollbackPoint({
        record: undefined,
        remaining: [m("0001_a", "lacks")],
        point: "0001_a",
      })
    ).toEqual({ kind: "own-source" });
  });

  it("leaves a point whose own snapshot carries the metadata to that snapshot", () => {
    expect(
      judgeRollbackPoint({
        record: { point: "0001_a", baseline: BASELINE },
        remaining: [m("0001_a", "lacks"), m("0002_b", "carries")],
        point: "0002_b",
      })
    ).toEqual({ kind: "own-source" });
  });

  it("restores the baseline at the record's point, the point before any app migration included", () => {
    for (const point of ["0001_a", null]) {
      const remaining = point === null ? [] : [m("0001_a", "lacks")];
      expect(
        judgeRollbackPoint({
          record: { point, baseline: BASELINE },
          remaining,
          point,
        })
      ).toEqual({ kind: "baseline", baseline: BASELINE });
    }
  });

  it("refuses a point without the metadata that is not the record's, naming it", () => {
    const judged = judgeRollbackPoint({
      record: { point: "0002_b", baseline: BASELINE },
      remaining: [m("0001_a", "lacks")],
      point: "0001_a",
    });
    expect(judged.kind).toBe("refused");
    const message =
      judged.kind === "refused" ? judged.refusal.publicMessage : "";
    expect(message).toContain("`0001_a.sql`");
    expect(message).toContain("nothing records the registry there");
    expect(message).toContain("`0002_b.sql`");
    expect(message).toContain("new migration");
  });

  it("refuses the point before any app migration where the record is at a migration", () => {
    const judged = judgeRollbackPoint({
      record: { point: "0001_a", baseline: BASELINE },
      remaining: [],
      point: null,
    });
    expect(judged.kind).toBe("refused");
    expect(
      judged.kind === "refused" ? judged.refusal.publicMessage : ""
    ).toContain("the point before any app migration");
  });

  it("refuses the record's point where the record keeps no baseline and its snapshot lost the metadata", () => {
    expect(
      judgeRollbackPoint({
        record: { point: "0001_a" },
        remaining: [m("0001_a", "lacks")],
        point: "0001_a",
      }).kind
    ).toBe("refused");
  });
});

/** A snapshot declaring `app` permissions of the app's own, and `plugins` permissions by plugin. */
function snapshot(
  app: [string, string][],
  plugins: Record<string, [string, string][]> = {}
): RolledBackMigration["snapshot"] {
  const owned = (list: [string, string][]) =>
    Object.fromEntries(
      list.map(([action, resource]) => [
        `${action}-${resource}`,
        {
          action,
          resource,
          name: action,
          description: null,
          group: null,
          danger: false,
        },
      ])
    );
  return {
    entities: { collections: {}, singles: {}, fieldGroups: {} },
    permissions: {
      app: owned(app),
      plugins: Object.fromEntries(
        Object.entries(plugins).map(([plugin, list]) => [plugin, owned(list)])
      ),
      collections: {},
      singles: {},
    },
  };
}

/** A permission row. */
function row(
  slug: string,
  owner: string | null,
  orphanedAt: Date | null = null
): OrphanPassRow {
  const [action, ...rest] = slug.split("-");
  return {
    id: `id-${slug}`,
    slug,
    action,
    resource: rest.join("-"),
    owner,
    orphanedAt,
  };
}

const APPLIED = new Date(Date.UTC(2026, 10, 12, 12, 0, 10, 600));

describe("orphanMarksUndone", () => {
  const rolledBack: RolledBackMigration[] = [
    {
      snapshot: snapshot([["publish", "reports"]], {
        "@x/first": [["sync", "first"]],
      }),
      appliedAt: APPLIED,
    },
  ];

  function marks(rows: OrphanPassRow[], notInstalled: string[] = []) {
    return Object.fromEntries(
      orphanMarksUndone({
        rows,
        baseline: ["read-users", "archive-reports"],
        rolledBack,
        installed: [{ action: "sync", resource: "first" }],
        notInstalled: new Set(notInstalled),
      })
    );
  }

  it("orphans what a rolled-back migration made live, unless the baseline or an installed plugin declares it", () => {
    expect(
      marks([
        row("publish-reports", "app"),
        row("sync-first", "@x/first"),
        row("read-users", null),
      ])
    ).toEqual({ "id-publish-reports": true });
  });

  it("clears a mark set since the migration applied, in whole seconds, and keeps an older one", () => {
    // Stored in whole seconds, rounded down: still the migration's.
    const sameSecond = new Date(Date.UTC(2026, 10, 12, 12, 0, 10, 0));
    const before = new Date(Date.UTC(2026, 10, 12, 12, 0, 9, 999));
    expect(
      marks([
        row("archive-reports", "app", sameSecond),
        row("purge-third", "@x/third", sameSecond),
        row("export-reports", "app", before),
      ])
    ).toEqual({ "id-archive-reports": false, "id-purge-third": false });
  });

  it("keeps the mark of a plugin recorded uninstalled, and never clears a permission with no owner", () => {
    const after = new Date(Date.UTC(2026, 10, 12, 12, 0, 20));
    expect(
      marks(
        [
          row("send-second", "@x/second", after),
          row("read-pages", null, after),
        ],
        ["@x/second"]
      )
    ).toEqual({});
  });
});
