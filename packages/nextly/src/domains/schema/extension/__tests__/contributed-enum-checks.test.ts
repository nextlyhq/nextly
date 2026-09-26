/**
 * An enum column contributed to an entity table has to arrive WITH its check.
 *
 * A column a hook adds to a collection, Single or component reaches the
 * table's desired spec as a bare column, so the CHECK its `col.enum()` implies
 * — which `toTableSpec` derives for an extension table's own columns — was
 * never planned: the column was created as plain text and any value stored.
 *
 * Driven through the pipeline's own diff with the live side injected, so what
 * is asserted is the operation set dev push plans, not a helper's return.
 */
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../../pipeline/diff/types";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
} from "../../pipeline/pushschema-pipeline-stubs";
import type { DesiredSchema } from "../../pipeline/types";
import { generateRuntimeSchema } from "../../services/runtime-schema-generator";
import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../active-schema";
import { buildExtensionSchema } from "../build-extension-schema";
import { col } from "../dsl";
import { enumCheckName, withContributedEnumChecks } from "../enum-check";
import type { ExtensionColumn } from "../types";

const TABLES = ["dc_posts", "single_site", "comp_hero"] as const;

const desired: DesiredSchema = {
  collections: {
    posts: { slug: "posts", tableName: "dc_posts", fields: [] as never },
  },
  singles: {
    site: { slug: "site", tableName: "single_site", fields: [] as never },
  },
  components: {
    hero: { slug: "hero", tableName: "comp_hero", fields: [] as never },
  },
} as DesiredSchema;

/** A `reviewState` enum contributed to each entity table, compiled and made active. */
async function activate(
  dialect: SupportedDialect,
  values: readonly string[] | null
) {
  const schema = await buildExtensionSchema({
    dialect,
    coreTableNames: [],
    entities: TABLES.map(name => ({
      name,
      slug: name,
      entityKind: name.startsWith("dc_")
        ? ("collection" as const)
        : name.startsWith("single_")
          ? ("single" as const)
          : ("component" as const),
      columns: [{ name: "id", kind: "varchar", nullable: false }],
    })),
    pluginPrefixes: new Map(),
    plugins: [],
    app: {
      owner: { kind: "app" },
      extend: [
        ({ schema: draft }) => {
          for (const table of TABLES) {
            draft.extendTable(table, {
              columns: {
                reviewState:
                  values === null
                    ? col.shortText({ nullable: true })
                    : col.enum(values, { nullable: true }),
              },
            });
          }
        },
      ],
    },
  });
  setActiveExtensionSchema(dialect, schema);
  return schema;
}

/** The operations dev push plans against `live`, as the rename detector sees them. */
async function plannedOps(
  dialect: SupportedDialect,
  live: NextlySchemaSnapshot
): Promise<Operation[]> {
  const detect = vi.fn().mockResolvedValue([]);
  const pipeline = new PushSchemaPipeline(
    {
      executor: { executeStatements: vi.fn().mockResolvedValue(undefined) },
      renameDetector: { detect },
      classifier: noopClassifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    },
    {
      _kitOverride: {
        pushSchema: vi.fn().mockResolvedValue({ sqlStatements: [], hints: [] }),
      },
      _buildDrizzleSchemaOverride: () => ({}),
      _txOverride: async fn => fn({}),
      _introspectSnapshotOverride: vi.fn().mockResolvedValue(live),
      _executePreResolutionOverride: vi.fn().mockResolvedValue(0),
    }
  );
  await pipeline.apply({
    desired,
    db: {},
    dialect,
    source: "code",
    promptChannel: "terminal",
  });
  return (detect.mock.calls[0]?.[0] ?? []) as Operation[];
}

const checkOps = (ops: readonly Operation[]) =>
  ops
    .filter(op => op.type === "add_check" || op.type === "drop_check")
    .map(op =>
      op.type === "add_check" || op.type === "drop_check"
        ? `${op.type}:${op.tableName}:${op.check.name}`
        : ""
    )
    .sort();

/** A live entity table carrying a check this pipeline never declared. */
const liveWith = (extra: Partial<TableSpec> = {}): NextlySchemaSnapshot => ({
  tables: TABLES.map(name => ({
    name,
    columns: [{ name: "id", type: "text", nullable: false }],
    checks: [{ name: `ck_${name}_legacy`, sql: "id <> ''" }],
    ...extra,
  })),
});

beforeEach(() => clearCachedSnapshot());
afterEach(() => {
  clearCachedSnapshot();
  clearActiveExtensionSchema();
});

describe("an enum column contributed to an entity table", () => {
  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "plans its check on every entity kind, and leaves the table's other checks alone (%s)",
    async dialect => {
      await activate(dialect, ["draft", "live"]);
      const ops = await plannedOps(dialect, liveWith());
      // Added on each table — and the undeclared `legacy` check, which
      // tracking checks on the table now puts in view, is NOT dropped.
      expect(checkOps(ops)).toEqual(
        TABLES.map(
          table => `add_check:${table}:ck_${table}_review_state_enum`
        ).sort()
      );
    }
  );

  it("replans the check when its values change", async () => {
    await activate("postgresql", ["draft", "live", "archived"]);
    const live = liveWith();
    for (const table of live.tables) {
      table.columns.push({
        name: "review_state",
        type: "text",
        nullable: true,
      });
      table.checks?.push({
        name: `ck_${table.name}_review_state_enum`,
        sql: "review_state IN ('draft', 'live')",
      });
    }
    const ops = await plannedOps("postgresql", live);
    expect(checkOps(ops)).toEqual(
      TABLES.flatMap(table => [
        `add_check:${table}:ck_${table}_review_state_enum`,
        `drop_check:${table}:ck_${table}_review_state_enum`,
      ]).sort()
    );
  });

  it("drops the check once the contributed column stops being an enum", async () => {
    await activate("postgresql", null);
    const live = liveWith();
    for (const table of live.tables) {
      table.columns.push({
        name: "review_state",
        type: "text",
        nullable: true,
      });
      table.checks?.push({
        name: `ck_${table.name}_review_state_enum`,
        sql: "review_state IN ('draft', 'live')",
      });
    }
    const ops = await plannedOps("postgresql", live);
    expect(checkOps(ops)).toEqual(
      TABLES.map(
        table => `drop_check:${table}:ck_${table}_review_state_enum`
      ).sort()
    );
  });

  it("puts the check on SQLite's runtime tables, which a rebuild is made from", async () => {
    // SQLite creates a check only with its table, and applies a check change
    // by rebuilding from these definitions: one without the check never gets
    // it, and loses it on any later rebuild.
    await activate("sqlite", ["draft", "live"]);
    const tables = [
      generateRuntimeSchema("dc_posts", [] as never, "sqlite").table,
      generateRuntimeSchema("single_site", [] as never, "sqlite").table,
      new FieldGroupSchemaService("sqlite").generateRuntimeSchema(
        "comp_hero",
        [],
        { typeColumn: "_component_type" }
      ),
    ];
    expect(
      tables.map(table =>
        getTableConfig(table as never).checks.map(check => check.name)
      )
    ).toEqual(TABLES.map(table => [`ck_${table}_review_state_enum`]));
  });
});

describe("withContributedEnumChecks", () => {
  const enumColumn: ExtensionColumn = {
    key: "reviewState",
    name: "review_state",
    kind: "text",
    nullable: true,
    hidden: true,
    enumValues: ["draft", "live"],
  } as ExtensionColumn;
  const spec: TableSpec = {
    name: "dc_posts",
    columns: [{ name: "id", type: "text", nullable: false }],
  };

  it("leaves a table with nothing to own untracked", () => {
    // `checks: undefined` is "not tracked"; setting it to a list would make
    // the diff drop every live check the list does not name.
    const out = withContributedEnumChecks(
      spec,
      [],
      { ...spec, checks: [{ name: "ck_dc_posts_legacy", sql: "id <> ''" }] },
      "postgresql"
    );
    expect(out.checks).toBeUndefined();
  });

  it("drops the check of a contributed column the table no longer has", () => {
    const stale = enumCheckName("dc_posts", { name: "review_state" });
    const out = withContributedEnumChecks(
      spec,
      [],
      {
        ...spec,
        columns: [
          ...spec.columns,
          { name: "review_state", type: "text", nullable: true },
        ],
        checks: [
          { name: "ck_dc_posts_legacy", sql: "id <> ''" },
          { name: stale, sql: "review_state IN ('draft')" },
        ],
      },
      "postgresql"
    );
    expect(out.checks?.map(check => check.name)).toEqual([
      "ck_dc_posts_legacy",
    ]);
  });

  it("drops an explicitly named check once its column stops being an enum", () => {
    // `col.enum(values, { name })` names the check freely, so it is matched
    // by the column it constrains, not by the default spelling.
    const plain = { ...enumColumn, enumValues: undefined } as ExtensionColumn;
    const out = withContributedEnumChecks(
      {
        ...spec,
        columns: [
          ...spec.columns,
          { name: "review_state", type: "text", nullable: true },
        ],
      },
      [plain],
      {
        ...spec,
        columns: [
          ...spec.columns,
          { name: "review_state", type: "text", nullable: true },
        ],
        checks: [
          { name: "ck_dc_posts_legacy", sql: "id <> ''" },
          {
            name: "ck_dc_posts_state_values",
            sql: "review_state IN ('draft', 'live')",
          },
        ],
      },
      "postgresql"
    );
    expect(out.checks?.map(check => check.name)).toEqual([
      "ck_dc_posts_legacy",
    ]);
  });

  it("replaces an explicitly named check the column now declares under another name", () => {
    const out = withContributedEnumChecks(
      {
        ...spec,
        columns: [
          ...spec.columns,
          { name: "review_state", type: "text", nullable: true },
        ],
      },
      [enumColumn],
      {
        ...spec,
        checks: [
          {
            name: "ck_dc_posts_state_values",
            sql: "review_state IN ('draft')",
          },
        ],
      },
      "postgresql"
    );
    expect(out.checks?.map(check => check.name)).toEqual([
      "ck_dc_posts_review_state_enum",
    ]);
  });

  it("keeps a value-set check on a column the contributions do not own", () => {
    const out = withContributedEnumChecks(
      spec,
      [enumColumn],
      {
        ...spec,
        checks: [{ name: "chk_dc_posts_kind", sql: "kind IN ('a', 'b')" }],
      },
      "postgresql"
    );
    expect(out.checks?.map(check => check.name)).toEqual([
      "chk_dc_posts_kind",
      "ck_dc_posts_review_state_enum",
    ]);
  });

  it("carries the check onto a table that does not exist yet", () => {
    const out = withContributedEnumChecks(
      spec,
      [enumColumn],
      undefined,
      "postgresql"
    );
    expect(out.checks?.map(check => check.name)).toEqual([
      "ck_dc_posts_review_state_enum",
    ]);
  });
});
