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

/** When a mark was set, which the judgement never reads. */
const MARKED = new Date(Date.UTC(2026, 10, 12, 12, 0, 10));

describe("orphanMarksUndone", () => {
  const rolledBack: RolledBackMigration[] = [
    {
      snapshot: snapshot([["publish", "reports"]], {
        "@x/first": [["sync", "first"]],
      }),
    },
  ];

  /** The marks over `rows`, with `@x/first` installed and `@x/second` and `app` configured but not. */
  function marks(rows: OrphanPassRow[]) {
    return Object.fromEntries(
      orphanMarksUndone({
        rows,
        point: {
          kind: "baseline",
          slugs: ["read-users", "archive-reports", "send-second"],
        },
        rolledBack,
        installed: [{ action: "sync", resource: "first" }],
        pluginDeclared: [
          { action: "sync", resource: "first", owner: "@x/first" },
          { action: "send", resource: "second", owner: "@x/second" },
          { action: "tally", resource: "app", owner: "app" },
        ],
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

  it("clears the mark of the app's own permission the baseline holds, though a plugin named app is not installed", () => {
    expect(
      marks([
        row("archive-reports", "app", MARKED),
        row("tally-app", "app", MARKED),
        row("export-reports", "app", MARKED),
      ])
    ).toEqual({ "id-archive-reports": false });
  });

  it("clears a plugin's mark only where it is installed and its current release declares it, whatever the baseline holds", () => {
    expect(
      marks([
        row("sync-first", "@x/first", MARKED),
        row("send-second", "@x/second", MARKED),
        row("drop-first", "@x/first", MARKED),
        row("purge-gone", "@x/gone", MARKED),
      ])
    ).toEqual({ "id-sync-first": false });
  });

  it("clears the mark of an entity's or core's permission the baseline holds, and no other", () => {
    expect(
      marks([row("read-users", null, MARKED), row("read-pages", null, MARKED)])
    ).toEqual({ "id-read-users": false });
  });
});

describe("orphanMarksUndone, for a plugin the point speaks for", () => {
  /** M1 records `@x/seo` declaring `read-seo`; the rolled-back M2 adds `audit-seo`, which v2 still declares. */
  const rolledBack: RolledBackMigration[] = [
    {
      snapshot: snapshot([["publish", "reports"]], {
        "@x/seo": [
          ["read", "seo"],
          ["audit", "seo"],
        ],
        "@x/late": [["sync", "late"]],
      }),
    },
  ];
  const installed = [
    { action: "read", resource: "seo" },
    { action: "audit", resource: "seo" },
    { action: "sync", resource: "late" },
  ];
  const pluginDeclared = installed.map(p => ({
    ...p,
    owner: p.resource === "seo" ? "@x/seo" : "@x/late",
  }));

  function marksAt(
    point: Parameters<typeof orphanMarksUndone>[0]["point"],
    rows: OrphanPassRow[]
  ) {
    return Object.fromEntries(
      orphanMarksUndone({ rows, point, rolledBack, installed, pluginDeclared })
    );
  }

  const atSnapshot = {
    kind: "snapshot" as const,
    declared: {
      declared: [
        { action: "read", resource: "users" },
        { action: "read", resource: "seo" },
      ],
      plugins: new Set(["@x/seo"]),
    },
  };

  it("orphans a plugin permission the point's snapshot does not declare, though its configured release does", () => {
    expect(
      marksAt(atSnapshot, [
        row("read-seo", "@x/seo"),
        row("audit-seo", "@x/seo"),
        row("publish-reports", "app"),
      ])
    ).toEqual({ "id-audit-seo": true, "id-publish-reports": true });
  });

  it("keeps the permissions of a plugin the point does not know, installed after it", () => {
    expect(marksAt(atSnapshot, [row("sync-late", "@x/late")])).toEqual({});
  });

  it("clears the marks the point's snapshot declares, an installed plugin's only where its release declares it too", () => {
    expect(
      marksAt(atSnapshot, [
        row("read-users", null, MARKED),
        row("read-seo", "@x/seo", MARKED),
        row("drop-seo", "@x/seo", MARKED),
        row("read-pages", null, MARKED),
      ])
    ).toEqual({ "id-read-users": false, "id-read-seo": false });
  });

  it("never clears a core permission's mark at a snapshot point, which declares no core permission", () => {
    expect(marksAt(atSnapshot, [row("delete-users", null, MARKED)])).toEqual(
      {}
    );
  });

  it("speaks, at the baseline, for each plugin one of whose permissions it holds", () => {
    expect(
      marksAt({ kind: "baseline", slugs: ["read-seo"] }, [
        row("read-seo", "@x/seo"),
        row("audit-seo", "@x/seo"),
        row("sync-late", "@x/late"),
      ])
    ).toEqual({ "id-audit-seo": true });
  });

  it("takes a permission the point declares under any owner as declared, as a plugin's action on a Builder collection", () => {
    const point = {
      kind: "snapshot" as const,
      declared: {
        declared: [
          { action: "read", resource: "seo" },
          { action: "audit", resource: "seo" },
        ],
        plugins: new Set(["@x/seo"]),
      },
    };
    expect(marksAt(point, [row("audit-seo", "@x/seo")])).toEqual({});
    expect(marksAt(point, [row("audit-seo", "@x/seo", MARKED)])).toEqual({
      "id-audit-seo": false,
    });
  });
});
