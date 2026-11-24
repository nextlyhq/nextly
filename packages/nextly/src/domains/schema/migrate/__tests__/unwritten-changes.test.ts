/**
 * The comparison `nextly migrate`, the boot step and `migrate:check` make
 * between the declared schema and the newest snapshot: each storage
 * difference is named, in both directions, and a snapshot written before
 * settings or permissions were recorded is never a difference by its silence.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../../i18n/per-language-storage";

import { toMinimalEntities } from "../../migrate-create/config-entities";
import type { PermissionRecord } from "../../migrate-create/declared-permissions";
import { settingsRecordOf } from "../../migrate-create/entity-settings";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../../migrate-create/generate";
import { NO_APP_STREAM_TABLES } from "../../migrate-create/app-stream";
import type { SnapshotFile } from "../../migrate-create/snapshot-io";
import { pendingChanges } from "../../pending/plan-pending";
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
): { filename: string; data: SnapshotFile } {
  return {
    filename: "20261101_000000_posts.snapshot.json",
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

/** A migrations folder of the file's own: the plan reads what it holds, which is nothing. */
const MIGRATIONS = mkdtempSync(join(tmpdir(), "unwritten-changes-"));
afterAll(() => rmSync(MIGRATIONS, { recursive: true, force: true }));

/** No table change: for the cases about settings and permissions alone. */
const NO_TABLES = {
  tables: [],
  beside: [],
  perLanguageMoves: [],
  permissions: [],
};

type CompareArgs = Parameters<typeof compareWithNewestSnapshot>[0];

/** The comparison over the table changes `migrate:create` plans for `args.entities` (`pendingChanges`). */
async function compareOver(
  args: Omit<CompareArgs, "pending" | "latest"> & {
    latest: ReturnType<typeof snapshotOf> | null;
  }
) {
  const pending = await pendingChanges({
    inputs: {
      collections: [...args.entities.collections],
      singles: [...args.entities.singles],
      components: [...args.entities.components],
      appStream: NO_APP_STREAM_TABLES,
      latest: args.latest,
    },
    dialect: DIALECT,
    migrationsDir: MIGRATIONS,
    permissions: args.permissions,
  });
  return compareWithNewestSnapshot({ ...args, pending });
}

function compare(
  before: DeclaredEntities,
  after: DeclaredEntities,
  extra: Partial<Omit<CompareArgs, "pending" | "latest">> = {}
) {
  return compareOver({
    entities: after,
    permissions: NO_PERMISSIONS,
    latest: snapshotOf(before),
    ...extra,
  });
}

const TITLE = { name: "title", type: "text" };

describe("compareWithNewestSnapshot", () => {
  it("names nothing when the declared schema is the snapshot's", async () => {
    const posts = entitiesOf(collection([TITLE]));
    expect(nothingUnwritten(await compare(posts, posts))).toBe(true);
  });

  it("names a field's size changed", async () => {
    const short = (maxLength: number) => ({
      ...TITLE,
      options: { variant: "short" },
      validation: { maxLength },
    });
    const changes = await compare(
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
  ])("names a field's %s changed", async (_what, field, opType) => {
    const changes = await compare(
      entitiesOf(collection([TITLE])),
      entitiesOf(collection([field]))
    );
    expect(changes.tables.map(op => op.type)).toContain(opType);
  });

  it("names a column's default changed", async () => {
    // A field's own default is applied by the application, never stored as a column default; a
    // column's stored default (a system column's) is storage, and its change is named.
    const posts = entitiesOf(collection([TITLE], { status: true }));
    const latest = snapshotOf(posts);
    const table = latest.data.snapshot.tables.find(t => t.name === "dc_posts")!;
    const status = table.columns.find(c => c.name === "status")!;
    status.default = "'published'";
    const changes = await compareOver({
      entities: posts,
      permissions: NO_PERMISSIONS,
      latest,
    });
    expect(changes.tables.map(op => op.type)).toContain(
      "change_column_default"
    );
  });

  it("names an index added", async () => {
    const changes = await compare(
      entitiesOf(collection([TITLE])),
      entitiesOf(collection([TITLE], { indexes: [{ fields: ["title"] }] }))
    );
    expect(changes.tables.map(op => op.type)).toContain("add_index");
  });

  it("names a relation that changes its storage", async () => {
    const author = {
      name: "author",
      type: "relationship",
      relationTo: "users",
    };
    const changes = await compare(
      entitiesOf(collection([TITLE, author])),
      entitiesOf(collection([TITLE, { ...author, hasMany: true }]))
    );
    expect(changes.tables.length).toBeGreaterThan(0);
  });

  it("names a field and a collection removed, as removed", async () => {
    const changes = await compare(
      entitiesOf(collection([TITLE, { name: "body", type: "text" }])),
      entitiesOf([])
    );
    expect(unwrittenChangeLines(changes)).toContain("- drop_table dc_posts");
    const field = await compare(
      entitiesOf(collection([TITLE, { name: "body", type: "text" }])),
      entitiesOf(collection([TITLE]))
    );
    expect(unwrittenChangeLines(field)).toContain(
      "- drop_column dc_posts.body"
    );
  });

  it("names every declared table as added over an empty folder", async () => {
    const changes = await compareOver({
      entities: entitiesOf(collection([TITLE])),
      permissions: NO_PERMISSIONS,
      latest: null,
    });
    expect(changes.noSnapshot).toBe(true);
    expect(unwrittenChangeLines(changes)).toContain("+ add_table dc_posts");
  });

  it("names a setting changed, and a description cleared", async () => {
    const before = entitiesOf(
      collection([TITLE], { description: "All posts" })
    );
    const changes = await compare(before, entitiesOf(collection([TITLE])));
    expect(changes.tables).toEqual([]);
    expect(unwrittenChangeLines(changes)).toEqual([
      "~ settings posts: description (cleared)",
    ]);
  });

  it("names no change for an empty settings object beside an absent one, as a Builder create leaves them", async () => {
    // The Builder writes `admin: {}` into its definition; the snapshot its save records has none.
    const recordedWithout = entitiesOf(collection([TITLE]));
    const declaredEmpty = entitiesOf(collection([TITLE], { admin: {} }));
    expect(
      nothingUnwritten(await compare(recordedWithout, declaredEmpty))
    ).toBe(true);
    expect(
      nothingUnwritten(await compare(declaredEmpty, recordedWithout))
    ).toBe(true);
    // An empty object that means something is a change: `versions: {}` turns versioning on with
    // its defaults, where an omitted `versions` leaves it off.
    expect(
      unwrittenChangesError(
        await compare(
          recordedWithout,
          entitiesOf(collection([TITLE], { versions: {} }))
        )
      )?.code
    ).toBe("SETTINGS_CHANGE_WITHOUT_MIGRATION");
    expect(
      nothingUnwritten(
        await compare(
          entitiesOf(collection([TITLE], { versions: {} })),
          recordedWithout
        )
      )
    ).toBe(false);
    // Holding a setting, it is a change.
    expect(
      unwrittenChangeLines(
        await compare(
          recordedWithout,
          entitiesOf(collection([TITLE], { admin: { group: "Content" } }))
        )
      )
    ).toEqual(["~ settings posts: admin.group"]);
  });

  it("never names a snapshot's missing settings, and compares with the registry where it has recorded them", async () => {
    const before = entitiesOf(collection([TITLE]));
    const after = entitiesOf(collection([TITLE], { description: "New" }));
    const older = snapshotOf(before, { entities: undefined });
    const silent = compareWithNewestSnapshot({
      pending: NO_TABLES,
      entities: after,
      permissions: NO_PERMISSIONS,
      latest: older,
    });
    expect(nothingUnwritten(silent)).toBe(true);
    const recorded = compareWithNewestSnapshot({
      pending: NO_TABLES,
      entities: after,
      permissions: NO_PERMISSIONS,
      latest: older,
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

  it("names a plugin's permission added and removed", async () => {
    const posts = entitiesOf(collection([TITLE]));
    const added = await compare(posts, posts, {
      permissions: {
        ...NO_PERMISSIONS,
        plugins: { "@acme/forms": { "export-submissions": exportPermission } },
      },
    });
    expect(unwrittenChangeLines(added)).toEqual([
      "~ permissions @acme/forms: + export-submissions",
    ]);
    const removed = compareWithNewestSnapshot({
      pending: NO_TABLES,
      entities: posts,
      permissions: NO_PERMISSIONS,
      latest: snapshotOf(posts, {
        permissions: {
          ...NO_PERMISSIONS,
          plugins: {
            "@acme/forms": { "export-submissions": exportPermission },
          },
        },
      }),
    });
    expect(unwrittenChangeLines(removed)).toEqual([
      "~ permissions @acme/forms: - export-submissions",
    ]);
  });

  it("never names a snapshot's missing permissions, and compares with the live ones where the database has them", async () => {
    const posts = entitiesOf(collection([TITLE]));
    const declared = {
      ...NO_PERMISSIONS,
      plugins: { "@acme/forms": { "export-submissions": exportPermission } },
    };
    const older = snapshotOf(posts, { permissions: undefined });
    expect(
      nothingUnwritten(
        compareWithNewestSnapshot({
          pending: NO_TABLES,
          entities: posts,
          permissions: declared,
          latest: older,
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
      pending: NO_TABLES,
      entities: posts,
      permissions: declared,
      latest: older,
      recorded: { permissions: live },
    });
    expect(unwrittenChangeLines(changes)).toEqual([
      "~ permissions @acme/forms: + export-submissions",
    ]);
  });

  it("over kept slugs alone, names a declared permission added since and never one removed", async () => {
    const posts = entitiesOf(collection([TITLE]));
    const older = snapshotOf(posts, { permissions: undefined });
    const declares = (plugins: PermissionRecord["plugins"]) =>
      unwrittenChangeLines(
        compareWithNewestSnapshot({
          pending: NO_TABLES,
          entities: posts,
          permissions: { ...NO_PERMISSIONS, plugins },
          latest: older,
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
  it("is SCHEMA_DRIFT naming every difference and migrate:create", async () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({
      name: `f${i}`,
      type: "text",
    }));
    const changes = await compare(
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

  it("is SETTINGS_CHANGE_WITHOUT_MIGRATION for settings alone", async () => {
    const changes = await compare(
      entitiesOf(collection([TITLE], { description: "All posts" })),
      entitiesOf(collection([TITLE]))
    );
    expect(unwrittenChangesError(changes)?.code).toBe(
      "SETTINGS_CHANGE_WITHOUT_MIGRATION"
    );
  });

  it("names migrate:baseline when asked to", async () => {
    const changes = await compare(
      entitiesOf([]),
      entitiesOf(collection([TITLE]))
    );
    expect(
      unwrittenChangesError(changes, { baselineFirst: true })?.next
    ).toContain("nextly migrate:baseline");
  });

  it("is undefined when nothing differs", async () => {
    const posts = entitiesOf(collection([TITLE]));
    expect(unwrittenChangesError(await compare(posts, posts))).toBeUndefined();
  });

  describe("over a snapshot written before text was kept per language", () => {
    afterEach(() => _resetPerLanguageStorage());

    /** The refusal a comparison ends in; the case fails where it ends in none. */
    function refusalOf(changes: Parameters<typeof unwrittenChangesError>[0]) {
      const error = unwrittenChangesError(changes);
      if (error === undefined)
        throw new Error("the comparison refused nothing");
      return error;
    }

    /** The newest snapshot as an earlier release wrote it: `title` on the main table. */
    function earlierSnapshot(entities: DeclaredEntities) {
      setPerLanguageStorage(false);
      const latest = snapshotOf(entities);
      _resetPerLanguageStorage();
      return latest;
    }

    it("names the title's drop as a move, explains it, and still asks a migration for the other change", async () => {
      const before = entitiesOf(collection([TITLE]));
      const after = entitiesOf(
        collection([TITLE, { name: "views", type: "number" }])
      );
      const { code, why, next } = refusalOf(
        await compareOver({
          entities: after,
          permissions: NO_PERMISSIONS,
          latest: earlierSnapshot(before),
        })
      );
      expect(code).toBe("SCHEMA_DRIFT");
      // The title's drop is the translations file's, which `migrate:create` writes beside the main one.
      expect(why).toContain("~ translations table dc_posts");
      expect(why).not.toContain("drop_column dc_posts.title");
      expect(why).toContain("dc_posts: title -> dc_posts_locales");
      expect(why).toContain("Nothing is lost");
      expect(next).toContain("localized: false");
      expect(next).toContain("`localization`");
      // The added number is not a move: it still needs its migration.
      expect(why).toContain("+ add_column dc_posts.views");
      expect(next).toContain(
        "For the other changes listed: Run `nextly migrate:create"
      );
    });

    // The moved fields of a table are one line of the list, its translations file, however many
    // they are, so the lines cannot be counted against the columns to find the other changes. A
    // snapshot that records settings names an added field twice, by its column and its settings.
    it.each([
      ["two fields move, over a snapshot that records settings", 2, true],
      ["three fields move, over a snapshot that records settings", 3, true],
      ["two fields move, over a snapshot that records no settings", 2, false],
    ] as const)(
      "asks a migration for the other change where %s",
      async (_what, count, recordsSettings) => {
        const texts = ["title", "summary", "body"]
          .slice(0, count)
          .map(name => ({ name, type: "text" }));
        const before = entitiesOf(collection(texts));
        const earlier = earlierSnapshot(before);
        const latest = recordsSettings
          ? earlier
          : { ...earlier, data: { ...earlier.data, entities: undefined } };
        const nextOver = async (entities: DeclaredEntities) =>
          refusalOf(
            await compareOver({
              entities,
              permissions: NO_PERMISSIONS,
              latest,
            })
          ).next;

        expect(
          await nextOver(
            entitiesOf(
              collection([...texts, { name: "views", type: "number" }])
            )
          )
        ).toContain("For the other changes listed");
        // Nothing but the moves: no other change to ask for.
        expect(await nextOver(before)).not.toContain(
          "For the other changes listed"
        );
      }
    );

    it("names a field removed from the config as a drop, with no move explained", async () => {
      const before = entitiesOf(
        collection([TITLE, { name: "views", type: "number" }])
      );
      // The same earlier snapshot, but `title` marked to stay on the main table: only `views` goes.
      const kept = entitiesOf(collection([{ ...TITLE, localized: false }]));
      const { why, next } = refusalOf(
        await compareOver({
          entities: kept,
          permissions: NO_PERMISSIONS,
          latest: earlierSnapshot(before),
        })
      );
      expect(why).toContain("- drop_column dc_posts.views");
      expect(why).not.toContain("moves to");
      expect(why).not.toContain("Nothing is lost");
      expect(next).not.toContain("localized: false");
    });
  });
});
