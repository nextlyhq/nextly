/**
 * Dialect-shape unit tests for the entity-delete i18n teardown.
 *
 * The integration suite covers behavior on real databases; these cover the per-dialect SQL
 * text, specifically that Postgres emits CASCADE. Without it, dropping a table that a
 * companion's FK references raises, so the main table would survive its own delete.
 */

import { describe, expect, it, vi } from "vitest";

import { teardownEntityI18n } from "../teardown-entity-i18n";

function makeAdapter(
  dialect: "postgresql" | "mysql" | "sqlite",
  tableExists: (name: string) => boolean
) {
  return {
    dialect,
    executeQuery: vi.fn().mockResolvedValue([]),
    tableExists: vi.fn(async (name: string) => tableExists(name)),
    getDrizzle: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 3 }),
      }),
    }),
  };
}

describe("teardownEntityI18n dialect SQL", () => {
  it("emits CASCADE for the companion drop on Postgres", async () => {
    const adapter = makeAdapter("postgresql", n => n === "dc_pages_locales");

    await teardownEntityI18n({ adapter, slug: "pages", tableName: "dc_pages" });

    expect(adapter.executeQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "dc_pages_locales" CASCADE'
    );
  });

  it("omits CASCADE on MySQL and backtick-quotes the identifier", async () => {
    const adapter = makeAdapter("mysql", n => n === "comp_seo_locales");

    await teardownEntityI18n({ adapter, slug: "seo", tableName: "comp_seo" });

    expect(adapter.executeQuery).toHaveBeenCalledWith(
      "DROP TABLE IF EXISTS `comp_seo_locales`"
    );
  });

  it("omits CASCADE on SQLite", async () => {
    const adapter = makeAdapter("sqlite", n => n === "single_home_locales");

    await teardownEntityI18n({
      adapter,
      slug: "home",
      tableName: "single_home",
    });

    expect(adapter.executeQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "single_home_locales"'
    );
  });

  it("never touches the archive when its table is absent", async () => {
    // The archive is created lazily on the first localization disable, so most databases
    // do not have it; reaching for the Drizzle handle there would throw on the delete path.
    const adapter = makeAdapter("postgresql", n => n === "dc_pages_locales");

    const result = await teardownEntityI18n({
      adapter,
      slug: "pages",
      tableName: "dc_pages",
    });

    expect(adapter.getDrizzle).not.toHaveBeenCalled();
    expect(result.archiveRowsPurged).toBe(0);
  });

  it("reports the purged archive row count when the archive exists", async () => {
    const adapter = makeAdapter("postgresql", () => true);

    const result = await teardownEntityI18n({
      adapter,
      slug: "pages",
      tableName: "dc_pages",
    });

    expect(result).toEqual({ companionDropped: true, archiveRowsPurged: 3 });
  });

  it("drops the companion but leaves the archive alone when the slug is unknown", async () => {
    // The archive is keyed by slug, and a slug cannot be recovered from a table name
    // because entities may declare a custom `tableName` — `dc_articles` can belong to slug
    // `blog`. Purging on a guess would delete another entity's translations.
    const adapter = makeAdapter("postgresql", () => true);

    const result = await teardownEntityI18n({
      adapter,
      slug: null,
      tableName: "dc_articles",
    });

    expect(result).toEqual({ companionDropped: true, archiveRowsPurged: 0 });
    expect(adapter.getDrizzle).not.toHaveBeenCalled();
    expect(adapter.executeQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "dc_articles_locales" CASCADE'
    );
  });
});
