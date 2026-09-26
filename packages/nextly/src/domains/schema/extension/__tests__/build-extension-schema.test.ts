/**
 * The one compiler: ordering, attribution, and a fingerprint that means
 * something.
 *
 * Ordering is the test that matters most. A hook running before the plugin it
 * depends on sees a schema without that plugin's tables, so a correct
 * declaration silently does nothing — and nothing fails, which is the worst
 * shape a bug can take here.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  buildExtensionSchema,
  type ExtensionSchemaInput,
} from "../build-extension-schema";
import { col, defineTable, type TableRelationInput } from "../dsl";
import type { SchemaContribution } from "../run-hooks";

const base = (
  plugins: SchemaContribution[],
  app?: SchemaContribution
): ExtensionSchemaInput => ({
  dialect: "postgresql",
  coreTableNames: ["users"],
  entities: [
    {
      name: "dc_posts",
      slug: "posts",
      entityKind: "collection",
      columns: [
        { name: "id", kind: "varchar", nullable: false },
        { name: "title", kind: "text", nullable: true },
      ],
    },
  ],
  pluginPrefixes: new Map([
    ["a", "a"],
    ["b", "b"],
  ]),
  plugins,
  ...(app ? { app } : {}),
});

const tableFor = (name: string) =>
  defineTable(name, { id: col.id(), label: col.text() });

describe("ordering", () => {
  it("lets a later plugin see an earlier plugin's table, and not the reverse", async () => {
    const aSaw: (string | undefined)[] = [];
    const bSaw: (string | undefined)[] = [];

    const schema = await buildExtensionSchema(
      base([
        {
          owner: { kind: "plugin", id: "a" },
          tables: [tableFor("things")],
          extend: [
            ({ schema: draft }) => {
              // a runs first, so b's table cannot exist yet.
              bSaw.push(draft.getTable("b__widgets")?.name);
            },
          ],
        },
        {
          owner: { kind: "plugin", id: "b" },
          tables: [tableFor("widgets")],
          extend: [
            ({ schema: draft }) => {
              aSaw.push(draft.getTable("a__things")?.name);
            },
          ],
        },
      ])
    );

    expect(aSaw).toEqual(["a__things"]);
    expect(bSaw).toEqual([undefined]);
    expect(schema.tables.map(t => t.name).sort()).toEqual([
      "a__things",
      "b__widgets",
    ]);
  });

  it("runs the app last, so it sees every plugin's tables", async () => {
    const seen: string[] = [];
    await buildExtensionSchema(
      base(
        [
          { owner: { kind: "plugin", id: "a" }, tables: [tableFor("things")] },
          { owner: { kind: "plugin", id: "b" }, tables: [tableFor("widgets")] },
        ],
        {
          owner: { kind: "app" },
          extend: [
            ({ schema: draft }) => {
              seen.push(
                ...draft
                  .tables()
                  .filter(t => t.owner.kind === "plugin")
                  .map(t => t.name)
              );
            },
          ],
        }
      )
    );
    expect(seen.sort()).toEqual(["a__things", "b__widgets"]);
  });
});

describe("attribution", () => {
  it("names the owner and hook position when a hook throws", async () => {
    const input = base([
      {
        owner: { kind: "plugin", id: "a" },
        extend: [
          () => {
            /* fine */
          },
          () => {
            throw new Error("boom");
          },
        ],
      },
    ]);

    await expect(buildExtensionSchema(input)).rejects.toThrow(NextlyError);
    try {
      await buildExtensionSchema(input);
    } catch (error) {
      // The useful question when this fires is WHOSE hook, not what the
      // message said — an unannotated throw names a file in someone else's
      // package and nothing else.
      expect((error as NextlyError).logContext).toMatchObject({
        owner: "plugin:a",
        hookIndex: 1,
      });
    }
  });
});

describe("the declarative form is sugar", () => {
  it("produces the same schema as a hook calling addTable", async () => {
    const declarative = await buildExtensionSchema(
      base([
        { owner: { kind: "plugin", id: "a" }, tables: [tableFor("things")] },
      ])
    );
    const viaHook = await buildExtensionSchema(
      base([
        {
          owner: { kind: "plugin", id: "a" },
          extend: [
            ({ schema: draft }) => {
              draft.addTable(tableFor("things"));
            },
          ],
        },
      ])
    );
    // Identical fingerprints, not merely similar output: one implementation of
    // what adding a table means.
    expect(viaHook.fingerprint).toBe(declarative.fingerprint);
  });
});

describe("fingerprint", () => {
  it("is stable across two builds of the same input", async () => {
    const input = base([
      { owner: { kind: "plugin", id: "a" }, tables: [tableFor("things")] },
    ]);
    const first = await buildExtensionSchema(input);
    const second = await buildExtensionSchema(input);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("changes when an index is added", async () => {
    const withoutIndex = await buildExtensionSchema(
      base([
        { owner: { kind: "plugin", id: "a" }, tables: [tableFor("things")] },
      ])
    );
    const withIndex = await buildExtensionSchema(
      base([
        {
          owner: { kind: "plugin", id: "a" },
          tables: [
            defineTable(
              "things",
              { id: col.id(), label: col.text() },
              { indexes: [{ columns: ["label"] }] }
            ),
          ],
        },
      ])
    );
    expect(withIndex.fingerprint).not.toBe(withoutIndex.fingerprint);
  });

  it("does not move when only the visit order changes", async () => {
    // Two plugins contributing independent tables describe one schema
    // whichever ran first, so a cache keyed on this must not miss.
    const a: SchemaContribution = {
      owner: { kind: "plugin", id: "a" },
      tables: [tableFor("things")],
    };
    const b: SchemaContribution = {
      owner: { kind: "plugin", id: "b" },
      tables: [tableFor("widgets")],
    };
    const forwards = await buildExtensionSchema(base([a, b]));
    const backwards = await buildExtensionSchema(base([b, a]));
    expect(backwards.fingerprint).toBe(forwards.fingerprint);
  });
});

describe("entity indexes", () => {
  it("carries an index on an entity table separately from owned tables", async () => {
    const schema = await buildExtensionSchema(
      base([
        {
          owner: { kind: "plugin", id: "a" },
          extend: [
            ({ schema: draft }) => {
              draft.extendTable("dc_posts", {
                indexes: [{ columns: ["title"] }],
              });
            },
          ],
        },
      ])
    );
    // Not emitted as an owned table: it belongs to a table this module does
    // not own, and app migrations carry it.
    expect(schema.tables).toHaveLength(0);
    expect(schema.entityIndexes.get("dc_posts")).toEqual([
      {
        columns: ["title"],
        unique: false,
        contributedBy: { kind: "plugin", id: "a" },
      },
    ]);
  });
});

describe("owners", () => {
  it("records who owns each compiled table", async () => {
    const schema = await buildExtensionSchema(
      base([
        { owner: { kind: "plugin", id: "a" }, tables: [tableFor("things")] },
      ])
    );
    expect(schema.owners.get("a__things")).toEqual({
      kind: "plugin",
      id: "a",
    });
  });
});

describe("relation edges", () => {
  it("declared relations surface as registry edges with snake-cased keys", async () => {
    const { col, defineTable } = await import("../dsl");
    const notes = defineTable(
      "notes",
      { id: col.id(), userId: col.shortText() },
      {
        relations: [
          {
            name: "user",
            kind: "one",
            targetTable: "users",
            fromColumn: "userId",
          },
          {
            name: "audit",
            kind: "many",
            targetTable: "fx__audit_log",
            toColumn: "note_id",
          },
        ],
      }
    );
    const auditLog = defineTable("audit_log", {
      id: col.id(),
      noteId: col.shortText(),
    });
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: ["users"],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        {
          owner: { kind: "plugin" as const, id: "fx" },
          tables: [notes, auditLog],
        },
      ],
    });
    expect(built.relations.get("fx__notes")).toEqual([
      // The compiled table's key, which is what the registry looks up.
      { key: "user", kind: "one", fromColumn: "userId", targetTable: "users" },
      // A many-edge keeps its kind, and its own end is the primary key
      // `defineTable` filled in: the target's `noteId` points back at it,
      // named by the SQL spelling and handed on as the compiled key.
      {
        key: "audit",
        kind: "many",
        fromColumn: "id",
        targetTable: "fx__audit_log",
        toColumn: "noteId",
      },
    ]);
  });

  it("a table with no declared relations contributes no edges", async () => {
    const { col, defineTable } = await import("../dsl");
    const plain = defineTable("plain", { id: col.id() });
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [plain] },
      ],
    });
    expect(built.relations.has("fx__plain")).toBe(false);
  });

  it("refuses a one-edge without its fromColumn", async () => {
    const { col, defineTable } = await import("../dsl");
    expect(() =>
      defineTable(
        "bad",
        { id: col.id() },
        {
          relations: [{ name: "x", kind: "one", targetTable: "users" }],
        }
      )
    ).toThrow(NextlyError);
  });
});

describe("many edges", () => {
  /**
   * An author and the posts pointing back at it: the shape a many-edge
   * exists for, where the reference lives on the TARGET.
   */
  const manySchema = async (relation: Record<string, unknown> = {}) => {
    const { col, defineTable } = await import("../dsl");
    const authors = defineTable(
      "authors",
      { id: col.id(), label: col.shortText() },
      {
        relations: [
          {
            name: "posts",
            kind: "many",
            targetTable: "fx__posts",
            toColumn: "authorId",
            ...relation,
          },
        ],
      }
    );
    const posts = defineTable("posts", {
      id: col.id(),
      authorId: col.shortText(),
    });
    return buildExtensionSchema({
      dialect: "sqlite" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        {
          owner: { kind: "plugin" as const, id: "fx" },
          tables: [authors, posts],
        },
      ],
    });
  };

  it("compiles to a many edge joined from the primary key to the target's column", async () => {
    const built = await manySchema();
    expect(built.relations.get("fx__authors")).toEqual([
      {
        key: "posts",
        kind: "many",
        fromColumn: "id",
        targetTable: "fx__posts",
        toColumn: "authorId",
      },
    ]);
  });

  it("is assembled by the registry as a many relation, and queried as one", async () => {
    // The whole chain short of a database: compile, register the way reload
    // does, assemble, and build the relational query. The emitted SQL is the
    // evidence — an edge built as a one would select a single row object,
    // and an edge joined on the wrong column would name it.
    const { SchemaRegistry } = await import(
      "../../../../database/schema-registry"
    );
    const { getDialectTables } = await import("../../../../database/index");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");

    const built = await manySchema();
    const registry = new SchemaRegistry("sqlite");
    registry.registerStaticSchemas(getDialectTables("sqlite"));
    for (const [name, table] of Object.entries(built.drizzle)) {
      registry.registerDynamicSchema(name, table, built.relations.get(name));
    }

    const relations = registry.getRelations();
    const edge = relations.fx__authors?.relations.posts;
    expect(edge?.relationType).toBe("many");
    expect(edge?.targetTableName).toBe("fx__posts");
    expect(edge?.sourceColumns.map(column => column.name)).toEqual(["id"]);
    expect(edge?.targetColumns.map(column => column.name)).toEqual([
      "author_id",
    ]);

    const db = drizzle.mock({ relations });
    const query = (
      db.query as unknown as Record<
        string,
        {
          findMany: (config: unknown) => { toSQL: () => { sql: string } };
        }
      >
    ).fx__authors.findMany({ with: { posts: true } });
    const { sql } = query.toSQL();
    expect(sql).toMatch(/json_group_array/);
    expect(sql).toContain('where "d0"."id" = "d1"."author_id"');
  });

  it("joins from a named fromColumn instead of the primary key", async () => {
    const built = await manySchema({ fromColumn: "label" });
    expect(built.relations.get("fx__authors")?.[0]).toMatchObject({
      kind: "many",
      fromColumn: "label",
    });
  });

  it("refuses a toColumn the compiled target does not declare", async () => {
    await expect(manySchema({ toColumn: "writerId" })).rejects.toSatisfy(
      NextlyError.isValidation
    );
  });

  /** One plugin table carrying a single declared edge, built for sqlite. */
  const edgeTo = async (relation: Record<string, unknown>) => {
    const { col, defineTable } = await import("../dsl");
    const accounts = defineTable(
      "accounts",
      { id: col.id() },
      {
        relations: [
          {
            name: "linked",
            kind: "many",
            ...relation,
          } as TableRelationInput,
        ],
      }
    );
    return buildExtensionSchema({
      dialect: "sqlite" as const,
      coreTableNames: ["users", "refresh_tokens"],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [accounts] },
      ],
    });
  };

  it("translates a core target's SQL column to the key the registry resolves", async () => {
    // `user_id` is the SQL spelling; the registry looks the column up on the
    // core bundle's table by its key, `userId`. Passed through unchanged, it
    // failed only once `getRelations` assembled every table's relations.
    const { SchemaRegistry } = await import(
      "../../../../database/schema-registry"
    );
    const { getDialectTables } = await import("../../../../database/index");
    const built = await edgeTo({
      targetTable: "refreshTokens",
      toColumn: "user_id",
    });
    expect(built.relations.get("fx__accounts")?.[0]).toMatchObject({
      targetTable: "refreshTokens",
      toColumn: "userId",
    });

    const registry = new SchemaRegistry("sqlite");
    registry.registerStaticSchemas(getDialectTables("sqlite"));
    for (const [name, table] of Object.entries(built.drizzle)) {
      registry.registerDynamicSchema(name, table, built.relations.get(name));
    }
    expect(
      registry.getRelations().fx__accounts?.relations.linked?.relationType
    ).toBe("many");
  });

  it("refuses a core target column the core table does not declare", async () => {
    await expect(
      edgeTo({ targetTable: "refreshTokens", toColumn: "owner_id" })
    ).rejects.toSatisfy(NextlyError.isValidation);
  });

  it("refuses a target column on a table it cannot check, and accepts that table's id", async () => {
    // A collection's table is registered at runtime from fields the compiler
    // never sees, so a column named on it could only fail later, for every
    // relational query at once.
    await expect(
      edgeTo({ targetTable: "dc_posts", toColumn: "author_id" })
    ).rejects.toSatisfy(NextlyError.isValidation);
    // Joining its id needs no column named, and still compiles.
    const built = await edgeTo({
      kind: "one",
      targetTable: "dc_posts",
      fromColumn: "id",
    });
    expect(built.relations.get("fx__accounts")?.[0]).toEqual({
      key: "linked",
      kind: "one",
      fromColumn: "id",
      targetTable: "dc_posts",
    });
  });

  it("refuses a many-edge without its toColumn, at defineTable", async () => {
    const { col, defineTable } = await import("../dsl");
    expect(() =>
      defineTable(
        "bad",
        { id: col.id() },
        {
          relations: [{ name: "x", kind: "many", targetTable: "fx__posts" }],
        }
      )
    ).toThrow(/Validation failed/);
  });

  it("refuses a many-edge with no fromColumn on a table with no primary key", async () => {
    const { col, defineTable } = await import("../dsl");
    let caught: unknown;
    try {
      defineTable(
        "keyless",
        { label: col.shortText() },
        {
          relations: [
            {
              name: "x",
              kind: "many",
              targetTable: "fx__posts",
              toColumn: "authorId",
            },
          ],
        }
      );
    } catch (error) {
      caught = error;
    }
    const errors =
      (caught as { publicData?: { errors?: { message?: string }[] } })
        ?.publicData?.errors ?? [];
    expect(errors.map(error => error.message).join(" ")).toMatch(/primary key/);
  });
});

describe("ref columns auto-produce one edges", () => {
  it("a ref() column carries its one-edge without an explicit relation", async () => {
    const { col, defineTable } = await import("../dsl");
    const linked = defineTable("linked", {
      id: col.id(),
      userId: col.ref("users"),
    });
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: ["users"],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [linked] },
      ],
    });
    expect(built.relations.get("fx__linked")).toEqual([
      // Named for its target, not after the column it would collide with.
      { key: "user", kind: "one", fromColumn: "userId", targetTable: "users" },
    ]);
  });

  it("an explicit relation with the same name wins over the auto edge", async () => {
    const { col, defineTable } = await import("../dsl");
    const linked = defineTable(
      "linked",
      { id: col.id(), userId: col.ref("users") },
      {
        relations: [
          {
            name: "user",
            kind: "one",
            targetTable: "admins",
            fromColumn: "userId",
          },
        ],
      }
    );
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: ["users", "admins"],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [linked] },
      ],
    });
    expect(built.relations.get("fx__linked")).toEqual([
      { key: "user", kind: "one", fromColumn: "userId", targetTable: "admins" },
    ]);
  });

  it("refuses a declared relation named after a column", async () => {
    // A row carries its columns and its relations under one set of keys, so
    // Drizzle refuses the pair when the relations are assembled — at boot,
    // far from the declaration. Refused here instead.
    const { col, defineTable } = await import("../dsl");
    let caught: unknown;
    try {
      defineTable(
        "linked",
        { id: col.id(), userId: col.ref("users") },
        {
          relations: [
            {
              name: "userId",
              kind: "one",
              targetTable: "admins",
              fromColumn: "userId",
            },
          ],
        }
      );
    } catch (error) {
      caught = error;
    }
    // The detail travels in `publicData.errors`, as every DSL refusal's does.
    const errors =
      (caught as { publicData?: { errors?: { message?: string }[] } })
        ?.publicData?.errors ?? [];
    expect(errors.map(error => error.message).join(" ")).toMatch(
      /same name as a column/
    );
  });

  it("names the edge <key>Ref when the key has no Id suffix", async () => {
    const { col, defineTable } = await import("../dsl");
    const linked = defineTable("linked", {
      id: col.id(),
      author: col.ref("users"),
    });
    expect(linked.relations.map(rel => rel.name)).toEqual(["authorRef"]);
  });
});

describe("adoptTable", () => {
  const legacy = async () => {
    const { col, defineTable } = await import("../dsl");
    return defineTable("legacy_orders", {
      id: col.id(),
      total: col.integer({ nullable: true }),
    });
  };

  it("an adopted table compiles to typed access but never enters managed state", async () => {
    const def = await legacy();
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map(),
      plugins: [],
      app: {
        owner: { kind: "app" as const },
        extend: [
          async ({ schema }) => {
            schema.adoptTable(def);
          },
        ],
      },
    });
    // Typed access exists...
    expect(Object.keys(built.adopted)).toEqual(["legacy_orders"]);
    expect(built.owners.get("legacy_orders")).toEqual({ kind: "app" });
    // ...and managed state does not: no spec for the diff, no kit table, no
    // fingerprint contribution (the hash covers specs + entity indexes only,
    // and the adopted table is in neither).
    expect(built.specs.find(t => t.name === "legacy_orders")).toBeUndefined();
    expect(built.drizzle["legacy_orders"]).toBeUndefined();
  });

  it("refuses an afterDrizzle hook that returns an adopted table", async () => {
    // Otherwise the returned table reads as one the hook introduced: owned by
    // the app and given a spec, so the app's migrations would create or alter
    // a table adoption promises never to touch.
    const { pgTable, text } = await import("drizzle-orm/pg-core");
    const def = await legacy();
    const build = (returned: string) =>
      buildExtensionSchema({
        dialect: "postgresql" as const,
        coreTableNames: [],
        entities: [],
        pluginPrefixes: new Map(),
        plugins: [],
        app: {
          owner: { kind: "app" as const },
          extend: [
            ({ schema }) => {
              schema.adoptTable(def);
            },
          ],
        },
        afterDrizzle: [
          () => ({
            [returned]: pgTable(returned, { id: text("id").primaryKey() }),
          }),
        ],
      });

    // The control: a table the hook genuinely introduces is still the app's.
    const introduced = await build("app_extra");
    expect(introduced.owners.get("app_extra")).toEqual({ kind: "app" });
    expect(introduced.specs.map(spec => spec.name)).toContain("app_extra");

    let caught: unknown;
    try {
      await build("legacy_orders");
    } catch (error) {
      caught = error;
    }
    expect(NextlyError.isValidation(caught)).toBe(true);
    const errors =
      (caught as { publicData?: { errors?: { message?: string }[] } })
        ?.publicData?.errors ?? [];
    expect(errors.map(error => error.message).join(" ")).toMatch(
      /adopted table/
    );
  });

  it("refuses to adopt a managed table's name", async () => {
    const { col, defineTable } = await import("../dsl");
    const owned = defineTable("taken", { id: col.id() });
    await expect(
      buildExtensionSchema({
        dialect: "postgresql" as const,
        coreTableNames: [],
        entities: [],
        pluginPrefixes: new Map([["fx", "fx"]]),
        plugins: [
          { owner: { kind: "plugin" as const, id: "fx" }, tables: [owned] },
        ],
        app: {
          owner: { kind: "app" as const },
          extend: [
            async ({ schema }) => {
              schema.adoptTable(defineTable("fx__taken", { id: col.id() }));
            },
          ],
        },
      })
    ).rejects.toThrow(NextlyError);
  });

  it("refuses adoption from a plugin", async () => {
    const { col, defineTable } = await import("../dsl");
    await expect(
      buildExtensionSchema({
        dialect: "postgresql" as const,
        coreTableNames: [],
        entities: [],
        pluginPrefixes: new Map([["fx", "fx"]]),
        plugins: [
          {
            owner: { kind: "plugin" as const, id: "fx" },
            extend: [
              async ({ schema }) => {
                schema.adoptTable(
                  defineTable("legacy_orders", { id: col.id() })
                );
              },
            ],
          },
        ],
      })
    ).rejects.toThrow(NextlyError);
  });
});

describe("app-contributed elements on plugin tables (C7)", () => {
  const pluginTable = async () => {
    const { col, defineTable } = await import("../dsl");
    return defineTable("notes", { id: col.id(), label: col.shortText() });
  };

  it("the app may index a plugin's table, and the element is recorded", async () => {
    const notes = await pluginTable();
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [notes] },
      ],
      app: {
        owner: { kind: "app" as const },
        extend: [
          ({ schema }) => {
            schema.extendTable("fx__notes", {
              indexes: [{ columns: ["label"], name: "idx_app_label" }],
            });
          },
        ],
      },
    });
    expect(built.elementOwners.get("fx__notes")).toEqual([
      {
        elementKind: "index",
        elementName: "idx_app_label",
        owner: { kind: "app" },
      },
    ]);
    // The index still compiles into the table's spec — the APP stream
    // creates it; the element row says whose it is.
    const spec = built.specs.find(t => t.name === "fx__notes");
    expect(spec?.indexes?.map(i => i.name)).toContain("idx_app_label");
  });

  it("a plugin indexing another plugin's table stays refused", async () => {
    const { col, defineTable } = await import("../dsl");
    const a = defineTable("alpha", { id: col.id(), tag: col.shortText() });
    await expect(
      buildExtensionSchema({
        dialect: "postgresql" as const,
        coreTableNames: [],
        entities: [],
        pluginPrefixes: new Map([
          ["fa", "fa"],
          ["fb", "fb"],
        ]),
        plugins: [
          { owner: { kind: "plugin" as const, id: "fa" }, tables: [a] },
          {
            owner: { kind: "plugin" as const, id: "fb" },
            extend: [
              ({ schema }) => {
                schema.extendTable("fa__alpha", {
                  indexes: [{ columns: ["tag"] }],
                });
              },
            ],
          },
        ],
      })
    ).rejects.toThrow(NextlyError);
  });
});
