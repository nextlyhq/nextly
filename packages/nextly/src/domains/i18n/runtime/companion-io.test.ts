import { describe, it, expect } from "vitest";

import {
  buildCompanionSchema,
  companionTableExists,
  splitLocalizedWrite,
} from "./companion-io";

type ProbeAdapter = Parameters<typeof companionTableExists>[0];

const makeAdapter = (
  executeQuery: ProbeAdapter["executeQuery"]
): ProbeAdapter => ({ dialect: "postgresql", executeQuery });

// The shared, entity-agnostic companion I/O seam — used by collections, singles, and
// components alike. These pin the two pure pieces: the schema shape (which fields are
// translatable) and the shared-vs-translatable write split.
describe("buildCompanionSchema", () => {
  it("returns the companion shape for a localized entity's translatable fields", () => {
    const schema = buildCompanionSchema({
      slug: "settings",
      tableName: "single_settings",
      fields: [
        { name: "siteName", type: "text", localized: false }, // shared (opt-out)
        { name: "tagline", type: "textarea" }, // translatable (default)
        { name: "views", type: "number" }, // shared (not text-like)
      ],
      dialect: "postgresql",
      status: false,
    });
    expect(schema).not.toBeNull();
    expect(schema!.companionTableName).toBe("single_settings_locales");
    expect(schema!.localizedFields.map(f => f.name)).toEqual(["tagline"]);
    // camelCase field name maps to snake_case companion column.
    expect(schema!.localizedFields[0].column).toBe("tagline");
  });

  it("maps camelCase field names to snake_case companion columns", () => {
    const schema = buildCompanionSchema({
      slug: "seo",
      tableName: "comp_seo",
      fields: [{ name: "metaTitle", type: "text" }],
      dialect: "postgresql",
    });
    expect(schema!.localizedFields[0]).toEqual({
      name: "metaTitle",
      column: "meta_title",
    });
  });

  it("returns null when the entity has no translatable fields", () => {
    const schema = buildCompanionSchema({
      slug: "counters",
      tableName: "dc_counters",
      fields: [{ name: "count", type: "number" }],
      dialect: "postgresql",
    });
    expect(schema).toBeNull();
  });
});

describe("companionTableExists", () => {
  it("returns true when the probe select succeeds", async () => {
    const adapter = makeAdapter(async () => []);
    expect(await companionTableExists(adapter, "single_x_locales")).toBe(true);
  });

  it("returns false only for a verified missing-table error", async () => {
    // Each dialect words an absent table differently; all must read as "false"
    // (a not-yet-migrated companion), never as an error.
    const missing = [
      'relation "single_x_locales" does not exist', // postgres
      "SQLITE_ERROR: no such table: single_x_locales", // sqlite
      "Table 'app.single_x_locales' doesn't exist", // mysql
    ];
    for (const message of missing) {
      const adapter = makeAdapter(async () => {
        throw new Error(message);
      });
      expect(await companionTableExists(adapter, "single_x_locales")).toBe(
        false
      );
    }
  });

  it("rethrows a non-missing-table probe error instead of reporting the table absent", async () => {
    // A transient/connection/permission failure must propagate: a caller gating
    // a write on this would otherwise silently skip the write and commit
    // unseeded, losing data.
    const adapter = makeAdapter(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    await expect(
      companionTableExists(adapter, "single_x_locales")
    ).rejects.toThrow("connection terminated");
  });
});

describe("splitLocalizedWrite", () => {
  const localizedFields = [
    { name: "tagline", column: "tagline" },
    { name: "metaTitle", column: "meta_title" },
  ];

  it("routes translatable keys to companion (by column) and the rest to main", () => {
    const { main, companion } = splitLocalizedWrite(
      { site_name: "Acme", tagline: "Hi", updated_at: 123 },
      localizedFields
    );
    expect(main).toEqual({ site_name: "Acme", updated_at: 123 });
    expect(companion).toEqual({ tagline: "Hi" });
  });

  it("omits keys absent from the payload (partial update touches only what was sent)", () => {
    const { main, companion } = splitLocalizedWrite(
      { metaTitle: "T" },
      localizedFields
    );
    expect(main).toEqual({});
    expect(companion).toEqual({ meta_title: "T" });
  });
});
