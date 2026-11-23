/**
 * What a production boot registers for the code-first collections and
 * singles in the config. A localized entity's translatable fields live only
 * on its `_locales` companion, which is what the migrations create, so the
 * main table registered for it must leave them out and the companion must be
 * registered too. A single registered without its `localized` switch kept
 * them on the main table, and every read of it on a migrated database failed
 * with "no such column". The dev server hid it, since its reload registers
 * the tables again correctly.
 */
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerConfigTablesInResolver } from "../register-config-tables";
import type { StartRegistry } from "../start-reads";

/** The registries a production start under way read once; none outside one. */
const start = vi.hoisted(() => ({
  registry: undefined as StartRegistry | undefined,
}));
vi.mock("../start-reads", () => ({
  startRegistryNow: () => start.registry,
}));

/** The tables a boot registered, by name. */
async function registered(config: Record<string, unknown>) {
  const tables = new Map<string, unknown>();
  await registerConfigTablesInResolver(
    {
      registerDynamicSchema: (name: string, table: unknown) =>
        tables.set(name, table),
    } as never,
    config as never,
    { getCapabilities: () => ({ dialect: "sqlite" }) } as never,
    {}
  );
  return tables;
}

/** A registered table's column names. */
const columns = (table: unknown) =>
  getTableConfig(table as never).columns.map(column => column.name);

const fields = [
  { name: "campaign", type: "text", localized: false },
  // Localized by the entity's switch, without saying so itself.
  { name: "headline", type: "text" },
];

describe("the tables a production boot registers", () => {
  it("leaves a localized single's translatable fields to its companion", async () => {
    const tables = await registered({
      singles: [
        { slug: "announcement", localized: true, status: true, fields },
      ],
    });

    const main = columns(tables.get("single_announcement"));
    expect(main).toContain("campaign");
    expect(main).not.toContain("headline");
    expect(columns(tables.get("single_announcement_locales"))).toContain(
      "headline"
    );
  });

  // The same rule, from the same helper, for a collection.
  it("registers a localized collection the same way", async () => {
    const tables = await registered({
      collections: [{ slug: "posts", localized: true, fields }],
    });

    expect(columns(tables.get("dc_posts"))).not.toContain("headline");
    expect(columns(tables.get("dc_posts_locales"))).toContain("headline");
  });

  // The control: a single that is not localized keeps every field on its
  // own table and has no companion.
  it("keeps every field on the table of a single that is not localized", async () => {
    const tables = await registered({
      singles: [{ slug: "footer", fields }],
    });

    expect(columns(tables.get("single_footer"))).toEqual(
      expect.arrayContaining(["campaign", "headline"])
    );
    expect(tables.has("single_footer_locales")).toBe(false);
  });
});

/**
 * Whether registering `next` over the tables `first` registered tells the
 * start that a table it serves differs from the registry's.
 */
async function differs(
  first: Record<string, unknown>,
  next: Record<string, unknown>
) {
  const tables = await registered(first);
  const overrides = { differed: false };
  await registerConfigTablesInResolver(
    {
      hasTable: (name: string) => tables.has(name),
      getTable: (name: string) => tables.get(name),
      registerDynamicSchema: (name: string, table: unknown) =>
        tables.set(name, table),
    } as never,
    next as never,
    { getCapabilities: () => ({ dialect: "sqlite" }) } as never,
    {},
    overrides
  );
  return overrides.differed;
}

describe("a table registered over the registry's", () => {
  const posts = (postFields: unknown[]) => ({
    collections: [{ slug: "posts", fields: postFields }],
  });

  it("differs from it when a column was added", async () => {
    expect(
      await differs(
        posts([{ name: "title", type: "text" }]),
        posts([
          { name: "title", type: "text" },
          { name: "summary", type: "text" },
        ])
      )
    ).toBe(true);
  });

  it("differs from it when only a column's settings changed", async () => {
    expect(
      await differs(
        posts([{ name: "title", type: "text" }]),
        posts([{ name: "title", type: "text", required: true }])
      )
    ).toBe(true);
  });

  it("does not differ when its columns are built the same", async () => {
    expect(
      await differs(
        posts([
          { name: "title", type: "text" },
          { name: "published", type: "date" },
        ]),
        posts([
          { name: "title", type: "text" },
          { name: "published", type: "date" },
        ])
      )
    ).toBe(false);
  });
});

/**
 * A production start leaves out a collection a demote handed to the Schema
 * Builder, from the registry rows it read once (`di/start-reads`): asking the
 * registry again was one more wait before the start resolved.
 */
describe("the collections a production start registers from the configuration", () => {
  afterEach(() => {
    start.registry = undefined;
  });

  it("leaves out a handed-over collection from the start's own reading, asking the database nothing", async () => {
    const asked: string[] = [];
    start.registry = {
      read: table => {
        asked.push(table);
        return Promise.resolve({
          exists: true,
          columns: undefined,
          rows: () =>
            Promise.resolve([
              {
                slug: "posts",
                table_name: "dc_posts",
                source: "ui",
                config_path: "demoted-from-code",
              },
            ]),
        });
      },
    };
    const tables = new Map<string, unknown>([["dc_posts", "the record's"]]);

    await registerConfigTablesInResolver(
      {
        hasTable: (name: string) => tables.has(name),
        registerDynamicSchema: (name: string, table: unknown) =>
          tables.set(name, table),
      } as never,
      {
        collections: [
          { slug: "posts", fields },
          { slug: "notes", fields },
        ],
      } as never,
      // An adapter that cannot be asked anything: the rows come from the start's reading.
      { getCapabilities: () => ({ dialect: "sqlite" }) } as never,
      {}
    );

    expect(asked).toEqual(["dynamic_collections"]);
    // The record's table stands; the code entry registered nothing over it.
    expect(tables.get("dc_posts")).toBe("the record's");
    expect(columns(tables.get("dc_notes"))).toContain("campaign");
  });
});
