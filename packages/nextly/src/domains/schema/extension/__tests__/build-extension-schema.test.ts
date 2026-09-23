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
import { col, defineTable } from "../dsl";
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
      { columns: ["title"], unique: false },
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
          { name: "user", kind: "one", targetTable: "users", fromColumn: "userId" },
          { name: "audit", kind: "many", targetTable: "audit_log", toColumn: "noteId" },
        ],
      }
    );
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: ["users"],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [{ owner: { kind: "plugin" as const, id: "fx" }, tables: [notes] }],
    });
    expect(built.relations.get("fx__notes")).toEqual([
      { key: "user", fromColumn: "user_id", targetTable: "users" },
      {
        key: "audit",
        fromColumn: "",
        targetTable: "audit_log",
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
      plugins: [{ owner: { kind: "plugin" as const, id: "fx" }, tables: [plain] }],
    });
    expect(built.relations.has("fx__plain")).toBe(false);
  });

  it("refuses a one-edge without its fromColumn", async () => {
    const { col, defineTable } = await import("../dsl");
    expect(() =>
      defineTable("bad", { id: col.id() }, {
        relations: [{ name: "x", kind: "one", targetTable: "users" }],
      })
    ).toThrow(NextlyError);
  });
});
