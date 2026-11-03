/**
 * The push's gate for a column made required over rows that would break it.
 *
 * A Builder apply and the development push both reach `PushSchemaPipeline.apply`. When a change
 * would make a column NOT NULL and nothing chosen in the dialog or the terminal fills the rows
 * first, the apply counts those rows and refuses before any statement runs, naming the entity, the
 * field and the count; a field group's refusal names each collection and Single whose rows break
 * it. Counted against a real SQLite database, so the counts are the database's own.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import type { Operation } from "../diff/types";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import type {
  Classifier,
  PromptDispatcher,
} from "../pushschema-pipeline-interfaces";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import { refuseRequiredColumnsOverNulls } from "../required-column-gate";
import type { ClassifierEvent, Resolution } from "../resolution/types";
import type { DesiredSchema } from "../types";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  clearCachedSnapshot();
  sqlite = new Database(":memory:");
  db = drizzle({ client: sqlite });
  sqlite.exec(`CREATE TABLE dc_posts (id TEXT, summary TEXT, body TEXT)`);
  sqlite.exec(
    `INSERT INTO dc_posts VALUES ('1', NULL, NULL), ('2', NULL, 'b'), ('3', 'c', NULL)`
  );
  sqlite.exec(`CREATE TABLE single_home (id TEXT, tagline TEXT)`);
  sqlite.exec(`INSERT INTO single_home VALUES ('1', NULL)`);
  sqlite.exec(
    `CREATE TABLE comp_promo (_parent_table TEXT, _parent_id TEXT, cta TEXT)`
  );
  sqlite.exec(
    `INSERT INTO comp_promo VALUES
      ('dc_posts', '1', NULL), ('dc_posts', '2', NULL), ('dc_pages', '1', 'go'),
      ('single_home', '1', NULL)`
  );
  // The registries the field group's users are named from: a field group's Builder apply knows
  // only the field group, so the collections and Singles holding its rows are read from these.
  sqlite.exec(`CREATE TABLE dynamic_collections (slug TEXT, table_name TEXT)`);
  sqlite.exec(
    `INSERT INTO dynamic_collections VALUES ('posts', 'dc_posts'), ('pages', 'dc_pages')`
  );
  sqlite.exec(`CREATE TABLE dynamic_singles (slug TEXT, table_name TEXT)`);
  sqlite.exec(`INSERT INTO dynamic_singles VALUES ('home', 'single_home')`);
});
afterEach(() => {
  sqlite.close();
  clearCachedSnapshot();
});

const posts: DesiredSchema = {
  collections: {
    posts: {
      slug: "posts",
      tableName: "dc_posts",
      fields: [
        { name: "summary", type: "text", required: true },
        { name: "body", type: "text", required: true },
      ] as never,
    },
  },
  singles: {},
  components: {},
};

const home: DesiredSchema = {
  collections: {},
  singles: {
    home: {
      slug: "home",
      tableName: "single_home",
      fields: [{ name: "tagline", type: "text", required: true }] as never,
    },
  },
  components: {},
};

/** A field group's Builder apply: the desired schema holds the field group alone. */
const promo: DesiredSchema = {
  collections: {},
  singles: {},
  components: {
    promo: {
      slug: "promo",
      tableName: "comp_promo",
      fields: [{ name: "cta", type: "text", required: true }] as never,
    },
  },
};

function madeRequired(table: string, column: string): ClassifierEvent {
  return {
    id: `add_not_null_with_nulls:${table}.${column}`,
    kind: "add_not_null_with_nulls",
    tableName: table,
    columnName: column,
    nullCount: 0,
    tableRowCount: 0,
    applicableResolutions: [
      "provide_default",
      "make_optional",
      "delete_nonconforming",
      "abort",
    ],
  };
}

function addedRequired(table: string, column: string): ClassifierEvent {
  return {
    id: `add_required_field_no_default:${table}.${column}`,
    kind: "add_required_field_no_default",
    tableName: table,
    columnName: column,
    tableRowCount: 0,
    applicableResolutions: ["provide_default", "make_optional", "abort"],
  };
}

/** The refusal's per-field messages, or `null` when the gate let the change through. */
async function refusal(
  desired: DesiredSchema,
  events: ClassifierEvent[],
  resolutions: Resolution[] = []
): Promise<string[] | null> {
  try {
    await refuseRequiredColumnsOverNulls({
      db,
      dialect: "sqlite",
      desired,
      events,
      resolutions,
      fieldGroupRegistryTable: undefined,
    });
  } catch (error) {
    if (!NextlyError.isValidation(error)) throw error;
    const data = error.publicData as {
      errors: { path: string; code: string; message: string }[];
    };
    expect(data.errors.every(e => e.code === "REQUIRED_COLUMN_HAS_NULLS")).toBe(
      true
    );
    return data.errors.map(e => e.message);
  }
  return null;
}

describe("refuseRequiredColumnsOverNulls", () => {
  it("names the collection, the field and the count, for every field made required", async () => {
    expect(
      await refusal(posts, [
        madeRequired("dc_posts", "summary"),
        madeRequired("dc_posts", "body"),
      ])
    ).toEqual([
      "Collection 'posts': field 'summary' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional.",
      "Collection 'posts': field 'body' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional.",
    ]);
  });

  // A table that is not a collection, a Single or a field group is refused too, named by its
  // table and column through the same refusal every road gives.
  it("names a table that is not an entity by its table and column", async () => {
    sqlite.exec(`CREATE TABLE plugin_forms (id TEXT, label TEXT)`);
    sqlite.exec(`INSERT INTO plugin_forms VALUES ('1', NULL), ('2', NULL)`);
    expect(
      await refusal(posts, [madeRequired("plugin_forms", "label")])
    ).toEqual([
      "Table 'plugin_forms': column 'label' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the column nullable.",
    ]);
  });

  it("refuses before anything runs when the rows cannot be counted, naming the table", async () => {
    const error = await refuseRequiredColumnsOverNulls({
      db,
      dialect: "sqlite",
      desired: posts,
      events: [madeRequired("dc_gone", "title")],
      resolutions: [],
      fieldGroupRegistryTable: undefined,
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.isValidation(error)).toBe(true);
    expect((error as NextlyError).publicData).toEqual({
      errors: [
        {
          path: "fields.title",
          code: "REQUIRED_COLUMN_UNCOUNTED",
          message:
            "Table 'dc_gone': the rows that would break making 'title' required could not be counted, so the change was refused before anything ran. Check that the database can be reached and the table read, then try again.",
        },
      ],
    });
  });

  it("names a Single", async () => {
    expect(
      await refusal(home, [madeRequired("single_home", "tagline")])
    ).toEqual([
      "Single 'home': field 'tagline' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the field optional.",
    ]);
  });

  it("counts every row for a required field added without a default", async () => {
    expect(
      await refusal(
        {
          ...posts,
          collections: {
            posts: {
              ...posts.collections.posts,
              fields: [
                { name: "subTitle", type: "text", required: true },
              ] as never,
            },
          },
        },
        [addedRequired("dc_posts", "sub_title")]
      )
    ).toEqual([
      "Collection 'posts': field 'subTitle' cannot be added as required without a default while 3 rows exist, which would hold no value in it. Give it a default, or add it as optional.",
    ]);
  });

  it("names a field group and each collection and Single whose rows break it, and no other", async () => {
    // `pages` holds a row of the field group too, with a value: it does not break the column, so
    // it is not named.
    expect(await refusal(promo, [madeRequired("comp_promo", "cta")])).toEqual([
      "Field group 'promo': field 'cta' cannot become required while 3 rows hold no value in it: 2 in collection 'posts', 1 in Single 'home'. Give those rows a value first, or keep the field optional.",
    ]);
  });

  it("lets through a change whose rows are filled first by a chosen answer", async () => {
    for (const kind of [
      "provide_default",
      "delete_nonconforming",
      "make_optional",
    ] as const) {
      const event = madeRequired("dc_posts", "summary");
      const answer = (
        kind === "provide_default"
          ? { kind, eventId: event.id, value: "x" }
          : { kind, eventId: event.id }
      ) as Resolution;
      expect(await refusal(posts, [event], [answer]), kind).toBeNull();
    }
  });

  it("refuses the unanswered column even when another is answered", async () => {
    const summary = madeRequired("dc_posts", "summary");
    expect(
      await refusal(
        posts,
        [summary, madeRequired("dc_posts", "body")],
        [{ kind: "provide_default", eventId: summary.id, value: "x" }]
      )
    ).toEqual([
      "Collection 'posts': field 'body' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional.",
    ]);
  });

  it("lets a column through when no row holds null in it any more", async () => {
    // The control the refusals need: the count is read now, not taken from the event.
    sqlite.exec(`UPDATE dc_posts SET summary = 'filled'`);
    expect(
      await refusal(posts, [madeRequired("dc_posts", "summary")])
    ).toBeNull();
  });
});

describe("PushSchemaPipeline.apply with an unanswered column made required", () => {
  it("refuses before any statement runs, with the gate's message", async () => {
    const events = [madeRequired("dc_posts", "summary")];
    const executeStatements = vi.fn().mockResolvedValue(undefined);
    const executePreRes = vi.fn().mockResolvedValue(0);
    const preCleanup = vi
      .fn()
      .mockImplementation(noopPreCleanupExecutor.execute);
    const classify = vi
      .fn<Classifier["classify"]>()
      .mockResolvedValue({ level: "interactive", events });
    // The Builder's dialog sent no answer for the column.
    const dispatch = vi.fn<PromptDispatcher["dispatch"]>().mockResolvedValue({
      confirmedRenames: [],
      resolutions: [],
      proceed: true,
    });
    const ops: Operation[] = [
      {
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "legacy",
        columnType: "text",
      },
      {
        type: "change_column_nullable",
        tableName: "dc_posts",
        columnName: "summary",
        fromNullable: true,
        toNullable: false,
      },
    ];
    const pipeline = new PushSchemaPipeline(
      {
        executor: { executeStatements },
        renameDetector: noopRenameDetector,
        classifier: { classify },
        promptDispatcher: { dispatch },
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: { execute: preCleanup },
        migrationJournal: noopMigrationJournal,
        notifier: noopNotifier,
      },
      {
        _kitOverride: {
          pushSchema: vi
            .fn()
            .mockResolvedValue({ sqlStatements: [], hints: [] }),
        },
        _buildDrizzleSchemaOverride: () => ({}),
        _txOverride: (async <T>(fn: (tx: unknown) => Promise<T>) =>
          fn(db)) as never,
        _introspectSnapshotOverride: async () => ({ tables: [] }),
        _executePreResolutionOverride: executePreRes,
        _resolvedOpsOverride: ops,
      }
    );

    const result = await pipeline.apply({
      desired: posts,
      db,
      dialect: "sqlite",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PRECONDITION_FAILED");
    expect(result.error?.message).toBe(
      "Collection 'posts': field 'summary' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional."
    );
    // Nothing reached the database: no drop, no pre-cleanup, no statement.
    expect(executePreRes).not.toHaveBeenCalled();
    expect(preCleanup).not.toHaveBeenCalled();
    expect(executeStatements).not.toHaveBeenCalled();
  });
});
