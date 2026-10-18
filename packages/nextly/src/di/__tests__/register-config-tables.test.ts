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
import { describe, expect, it } from "vitest";

import { registerConfigTablesInResolver } from "../register";

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
