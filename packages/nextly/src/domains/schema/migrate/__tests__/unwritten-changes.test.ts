/**
 * The comparison `nextly migrate`, the boot step and `migrate:check` make
 * between the declared schema and the newest snapshot: each storage
 * difference is named, in both directions, and a snapshot written before
 * settings or permissions were recorded is never a difference by its silence.
 */
import { describe, expect, it } from "vitest";

import { toMinimalEntities } from "../../migrate-create/config-entities";
import type { PermissionRecord } from "../../migrate-create/declared-permissions";
import { settingsRecordOf } from "../../migrate-create/entity-settings";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../../migrate-create/generate";
import { NO_APP_STREAM_TABLES } from "../../migrate-create/app-stream";
import type { SnapshotFile } from "../../migrate-create/snapshot-io";
import {
  compareWithNewestSnapshot,
  livePermissionsByOwner,
  nothingUnwritten,
  unwrittenChangeLines,
  unwrittenChangesError,
  type DeclaredEntities,
} from "../unwritten-changes";

const DIALECT = "postgresql" as const;

function collection(
  fields: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): MinimalConfigEntity[] {
  return toMinimalEntities(
    [{ slug: "posts", fields, ...extra }],
    e => `dc_${e.slug}`
  );
}

const NO_PERMISSIONS: PermissionRecord = {
  app: {},
  plugins: {},
  collections: {},
  singles: {},
};

function entitiesOf(collections: MinimalConfigEntity[]): DeclaredEntities {
  return { collections, singles: [], components: [] };
}

/** The newest snapshot as `migrate:create` would have written it for `entities`. */
function snapshotOf(
  entities: DeclaredEntities,
  extra: Partial<SnapshotFile> = {}
): { data: SnapshotFile } {
  return {
    data: {
      version: 1,
      migrationHash: "",
      snapshot: buildDesiredSnapshotFromConfig(
        [...entities.collections],
        [],
        [],
        DIALECT
      ),
      entities: settingsRecordOf(entities) ?? {
        collections: {},
        singles: {},
        fieldGroups: {},
      },
      permissions: NO_PERMISSIONS,
      ...extra,
    },
  };
}

function compare(
  before: DeclaredEntities,
  after: DeclaredEntities,
  extra: Partial<Parameters<typeof compareWithNewestSnapshot>[0]> = {}
) {
  return compareWithNewestSnapshot({
    entities: after,
    appStream: NO_APP_STREAM_TABLES,
    permissions: NO_PERMISSIONS,
    latest: snapshotOf(before),
    dialect: DIALECT,
    ...extra,
  });
}

const TITLE = { name: "title", type: "text" };

describe("compareWithNewestSnapshot", () => {
  it("names nothing when the declared schema is the snapshot's", () => {
    const posts = entitiesOf(collection([TITLE]));
    expect(nothingUnwritten(compare(posts, posts))).toBe(true);
  });

  it("names a field's size changed", () => {
    const short = (maxLength: number) => ({
      ...TITLE,
      options: { variant: "short" },
      validation: { maxLength },
    });
    const changes = compare(
      entitiesOf(collection([short(80)])),
      entitiesOf(collection([short(120)]))
    );
    expect(unwrittenChangeLines(changes)).toContain(
      "~ change_column_type dc_posts.title (varchar(80) -> varchar(120))"
    );
  });

  it.each([
    ["uniqueness", { ...TITLE, unique: true }, "add_index"],
    ["required", { ...TITLE, required: true }, "change_column_nullable"],
    ["type", { name: "title", type: "number" }, "change_column_type"],
  ])("names a field's %s changed", (_what, field, opType) => {
    const changes = compare(
      entitiesOf(collection([TITLE])),
      entitiesOf(collection([field]))
    );
    expect(changes.tables.map(op => op.type)).toContain(opType);
  });

  it("names a column's default changed", () => {
    // A field's own default is applied by the application, never stored as a column default; a
    // column's stored default (a system column's) is storage, and its change is named.
    const posts = entitiesOf(collection([TITLE], { status: true }));
    const latest = snapshotOf(posts);
    const table = latest.data.snapshot.tables.find(t => t.name === "dc_posts")!;
    const status = table.columns.find(c => c.name === "status")!;
    status.default = "'published'";
    const changes = compareWithNewestSnapshot({
      entities: posts,
      appStream: NO_APP_STREAM_TABLES,
      permissions: NO_PERMISSIONS,
      latest,
      dialect: DIALECT,
    });
    expect(changes.tables.map(op => op.type)).toContain(
      "change_column_default"
    );
  });

  it("names an index added", () => {
    const changes = compare(
      entitiesOf(collection([TITLE])),
      entitiesOf(collection([TITLE], { indexes: [{ fields: ["title"] }] }))
    );
    expect(changes.tables.map(op => op.type)).toContain("add_index");
  });

  it("names a relation that changes its storage", () => {
    const author = {
      name: "author",
      type: "relationship",
      relationTo: "users",
    };
    const changes = compare(
      entitiesOf(collection([TITLE, author])),
      entitiesOf(collection([TITLE, { ...author, hasMany: true }]))
    );
    expect(changes.tables.length).toBeGreaterThan(0);
  });

  it("names a field and a collection removed, as removed", () => {
    const changes = compare(
      entitiesOf(collection([TITLE, { name: "body", type: "text" }])),
      entitiesOf([])
    );
    expect(unwrittenChangeLines(changes)).toContain("- drop_table dc_posts");
    const field = compare(
      entitiesOf(collection([TITLE, { name: "body", type: "text" }])),
      entitiesOf(collection([TITLE]))
    );
    expect(unwrittenChangeLines(field)).toContain(
      "- drop_column dc_posts.body"
    );
  });

  it("names every declared table as added over an empty folder", () => {
    const changes = compareWithNewestSnapshot({
      entities: entitiesOf(collection([TITLE])),
      appStream: NO_APP_STREAM_TABLES,
      permissions: NO_PERMISSIONS,
      latest: null,
      dialect: DIALECT,
    });
    expect(changes.noSnapshot).toBe(true);
    expect(unwrittenChangeLines(changes)).toContain("+ add_table dc_posts");
  });

  it("names a setting changed, and a description cleared", () => {
    const before = entitiesOf(
      collection([TITLE], { description: "All posts" })
    );
    const changes = compare(before, entitiesOf(collection([TITLE])));
    expect(changes.tables).toEqual([]);
    expect(unwrittenChangeLines(changes)).toEqual([
      "~ settings posts: description (cleared)",
    ]);
  });

  it("names no change for an empty settings object beside an absent one, as a Builder create leaves them", () => {
    // The Builder writes `admin: {}` into its definition; the snapshot its save records has none.
    const recordedWithout = entitiesOf(collection([TITLE]));
    const declaredEmpty = entitiesOf(collection([TITLE], { admin: {} }));
    expect(nothingUnwritten(compare(recordedWithout, declaredEmpty))).toBe(
      true
    );
    expect(nothingUnwritten(compare(declaredEmpty, recordedWithout))).toBe(
      true
    );
    // An empty object that means something is a change: `versions: {}` turns versioning on with
    // its defaults, where an omitted `versions` leaves it off.
    expect(
      unwrittenChangesError(
        compare(
          recordedWithout,
          entitiesOf(collection([TITLE], { versions: {} }))
        )
      )?.code
    ).toBe("SETTINGS_CHANGE_WITHOUT_MIGRATION");
    expect(
      nothingUnwritten(
        compare(
          entitiesOf(collection([TITLE], { versions: {} })),
          recordedWithout
        )
      )
    ).toBe(false);
    // Holding a setting, it is a change.
    expect(
      unwrittenChangeLines(
        compare(
          recordedWithout,
          entitiesOf(collection([TITLE], { admin: { group: "Content" } }))
        )
      )
    ).toEqual(["~ settings posts: admin.group"]);
  });

  it("never names a snapshot's missing settings, and compares with the registry where it has recorded them", () => {
    const before = entitiesOf(collection([TITLE]));
    const after = entitiesOf(collection([TITLE], { description: "New" }));
    const older = snapshotOf(before, { entities: undefined });
    const silent = compareWithNewestSnapshot({
      entities: after,
      appStream: NO_APP_STREAM_TABLES,
      permissions: NO_PERMISSIONS,
      latest: older,
      dialect: DIALECT,
    });
    expect(nothingUnwritten(silent)).toBe(true);
    const recorded = compareWithNewestSnapshot({
      entities: after,
      appStream: NO_APP_STREAM_TABLES,
      permissions: NO_PERMISSIONS,
      latest: older,
      dialect: DIALECT,
      recorded: {
        settingsDiffer: [
          { kind: "collection", slug: "posts", changes: ["description"] },
        ],
      },
    });
    expect(unwrittenChangeLines(recorded)).toEqual([
      "~ settings posts: description",
    ]);
  });

  const exportPermission = {
    action: "export",
    resource: "submissions",
    name: "Export submissions",
    description: null,
    group: null,
    danger: false,
  };

  it("names a plugin's permission added and removed", () => {
    const posts = entitiesOf(collection([TITLE]));
    const added = compare(posts, posts, {
      permissions: {
        ...NO_PERMISSIONS,
        plugins: { "@acme/forms": { "export-submissions": exportPermission } },
      },
    });
    expect(unwrittenChangeLines(added)).toEqual([
      "~ permissions @acme/forms: + export-submissions",
    ]);
    const removed = compareWithNewestSnapshot({
      entities: posts,
      appStream: NO_APP_STREAM_TABLES,
      permissions: NO_PERMISSIONS,
      latest: snapshotOf(posts, {
        permissions: {
          ...NO_PERMISSIONS,
          plugins: {
            "@acme/forms": { "export-submissions": exportPermission },
          },
        },
      }),
      dialect: DIALECT,
    });
    expect(unwrittenChangeLines(removed)).toEqual([
      "~ permissions @acme/forms: - export-submissions",
    ]);
  });

  it("never names a snapshot's missing permissions, and compares with the live ones where the database has them", () => {
    const posts = entitiesOf(collection([TITLE]));
    const declared = {
      ...NO_PERMISSIONS,
      plugins: { "@acme/forms": { "export-submissions": exportPermission } },
    };
    const older = snapshotOf(posts, { permissions: undefined });
    expect(
      nothingUnwritten(
        compareWithNewestSnapshot({
          entities: posts,
          appStream: NO_APP_STREAM_TABLES,
          permissions: declared,
          latest: older,
          dialect: DIALECT,
        })
      )
    ).toBe(true);
    const live = livePermissionsByOwner(
      [
        {
          slug: "read-posts",
          action: "read",
          resource: "posts",
          name: "Read posts",
          description: null,
          permissionGroup: null,
          owner: null,
        },
      ],
      "app"
    );
    const changes = compareWithNewestSnapshot({
      entities: posts,
      appStream: NO_APP_STREAM_TABLES,
      permissions: declared,
      latest: older,
      dialect: DIALECT,
      recorded: { permissions: live },
    });
    expect(unwrittenChangeLines(changes)).toEqual([
      "~ permissions @acme/forms: + export-submissions",
    ]);
  });

  it("over kept slugs alone, names a declared permission added since and never one removed", () => {
    const posts = entitiesOf(collection([TITLE]));
    const older = snapshotOf(posts, { permissions: undefined });
    const declares = (plugins: PermissionRecord["plugins"]) =>
      unwrittenChangeLines(
        compareWithNewestSnapshot({
          entities: posts,
          appStream: NO_APP_STREAM_TABLES,
          permissions: { ...NO_PERMISSIONS, plugins },
          latest: older,
          dialect: DIALECT,
          // A record written before owners were kept: the slugs, whoever's.
          recorded: { permissionSlugs: ["read-posts", "import-submissions"] },
        })
      );

    expect(
      declares({
        "@acme/forms": {
          "import-submissions": exportPermission,
          "export-submissions": exportPermission,
        },
      })
    ).toEqual(["~ permissions @acme/forms: + export-submissions"]);
    // `import-submissions` was kept and is no longer declared: a slug alone
    // does not say whose it was, so it is not named.
    expect(declares({ "@acme/forms": {} })).toEqual([]);
  });
});

describe("unwrittenChangesError", () => {
  it("is SCHEMA_DRIFT naming every difference and migrate:create", () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({
      name: `f${i}`,
      type: "text",
    }));
    const changes = compare(
      entitiesOf(collection([TITLE])),
      entitiesOf(collection([TITLE, ...fields]))
    );
    const error = unwrittenChangesError(changes);
    expect(error?.code).toBe("SCHEMA_DRIFT");
    // Every one listed, the twelfth included: nothing is cut off.
    expect(error?.why).toContain("+ add_column dc_posts.f11");
    expect(error?.next).toContain("nextly migrate:create");
    expect(error?.next).not.toContain("migrate:baseline");
  });

  it("is SETTINGS_CHANGE_WITHOUT_MIGRATION for settings alone", () => {
    const changes = compare(
      entitiesOf(collection([TITLE], { description: "All posts" })),
      entitiesOf(collection([TITLE]))
    );
    expect(unwrittenChangesError(changes)?.code).toBe(
      "SETTINGS_CHANGE_WITHOUT_MIGRATION"
    );
  });

  it("names migrate:baseline when asked to", () => {
    const changes = compare(entitiesOf([]), entitiesOf(collection([TITLE])));
    expect(
      unwrittenChangesError(changes, { baselineFirst: true })?.next
    ).toContain("nextly migrate:baseline");
  });

  it("is undefined when nothing differs", () => {
    const posts = entitiesOf(collection([TITLE]));
    expect(unwrittenChangesError(compare(posts, posts))).toBeUndefined();
  });
});
