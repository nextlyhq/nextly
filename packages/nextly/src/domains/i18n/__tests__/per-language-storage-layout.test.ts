/**
 * The boot refusal of a database laid out for the other choice of per-language storage finds its
 * tables by the name the catalog reports them under. MySQL with `lower_case_table_names=1` (the
 * default on macOS and Windows) reports every table in lower case, so a `dbName` written in mixed
 * case must still be found there, in both directions of the refusal.
 */
import { describe, expect, it, vi } from "vitest";

// The live catalog, as such a MySQL server reports it: every table name in lower case.
const live = vi.hoisted(() => ({
  tables: [] as { name: string; columns: { name: string }[] }[],
  // How the MySQL server compares table names (`lower_case_table_names`).
  lowerCaseTableNames: 1,
}));
vi.mock("../../schema/pipeline/diff/introspect-live", () => ({
  introspectLiveColumns: () => Promise.resolve({ tables: live.tables }),
}));

import { NextlyError } from "../../../errors/nextly-error";
import { refuseMixedStorage } from "../per-language-storage-layout";

/** An adapter on `dialect`, whose MySQL server answers its `lower_case_table_names`. */
function adapterOn(dialect: "mysql" | "sqlite" | "postgresql") {
  return {
    dialect,
    getDrizzle: <T>() =>
      ({
        execute: () =>
          Promise.resolve([
            { lower_case_table_names: live.lowerCaseTableNames },
          ]),
      }) as T,
  };
}
const adapter = adapterOn("mysql");
const articles = {
  kind: "collection" as const,
  slug: "articles",
  tableName: "Site_Articles",
  fields: [
    { name: "headline", type: "text" },
    { name: "views", type: "number" },
  ],
};

/** The error `refuseMixedStorage` throws, or undefined when it lets the boot through. */
async function refusal(
  perLanguage: boolean,
  on = adapter,
  entities: Parameters<typeof refuseMixedStorage>[1] = [articles]
): Promise<unknown> {
  try {
    await refuseMixedStorage(on, entities, perLanguage);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("refuseMixedStorage on MySQL with lower-case table names", () => {
  it("finds a mixed-case table whose translatable columns are still on it, with the setting on", async () => {
    live.tables = [
      {
        name: "site_articles",
        columns: [{ name: "id" }, { name: "headline" }, { name: "views" }],
      },
    ];
    expect(
      NextlyError.isCode(
        await refusal(true),
        "NEXTLY_PER_LANGUAGE_STORAGE_MIXED"
      )
    ).toBe(true);
  });

  it("finds a mixed-case table whose translatable values are only per language, with the setting off", async () => {
    live.tables = [
      { name: "site_articles", columns: [{ name: "id" }, { name: "views" }] },
      {
        name: "site_articles_locales",
        columns: [
          { name: "_parent" },
          { name: "_locale" },
          { name: "headline" },
        ],
      },
    ];
    expect(
      NextlyError.isCode(
        await refusal(false),
        "NEXTLY_PER_LANGUAGE_STORAGE_MIXED"
      )
    ).toBe(true);
  });
});

describe("refuseMixedStorage by the server's own comparison rules", () => {
  // A collection marked translatable whose translatable column is still on its main table, as one
  // that gains `localized: true` in the same deployment leaves it: served per language, its value
  // would read as empty, and the push would drop the column.
  it("refuses a translatable entity whose translatable columns are still on its main table, with the setting on", async () => {
    live.lowerCaseTableNames = 1;
    live.tables = [
      {
        name: "site_articles",
        columns: [{ name: "id" }, { name: "headline" }, { name: "views" }],
      },
    ];
    expect(
      NextlyError.isCode(
        await refusal(true, adapter, [{ ...articles, localized: true }]),
        "NEXTLY_PER_LANGUAGE_STORAGE_MIXED"
      )
    ).toBe(true);
  });

  // SQLite compares column names without case, so a column spelled `Headline` is the
  // translatable `headline` all the same.
  it("finds a translatable column on SQLite whatever its case", async () => {
    live.tables = [
      {
        name: "Site_Articles",
        columns: [{ name: "id" }, { name: "Headline" }, { name: "views" }],
      },
    ];
    expect(
      NextlyError.isCode(
        await refusal(true, adapterOn("sqlite")),
        "NEXTLY_PER_LANGUAGE_STORAGE_MIXED"
      )
    ).toBe(true);
  });

  // MySQL with `lower_case_table_names=0` keeps table names whose case differs apart, so the
  // refusal reads the configured table, not another that folds to the same name.
  it("reads the configured table on a MySQL server that keeps table-name case", async () => {
    live.lowerCaseTableNames = 0;
    live.tables = [
      {
        name: "site_articles",
        columns: [{ name: "id" }, { name: "headline" }],
      },
      { name: "Site_Articles", columns: [{ name: "id" }, { name: "views" }] },
    ];
    expect(await refusal(true)).toBeUndefined();
    live.tables = [
      { name: "site_articles", columns: [{ name: "id" }, { name: "views" }] },
      {
        name: "Site_Articles",
        columns: [{ name: "id" }, { name: "headline" }, { name: "views" }],
      },
    ];
    expect(
      NextlyError.isCode(
        await refusal(true),
        "NEXTLY_PER_LANGUAGE_STORAGE_MIXED"
      )
    ).toBe(true);
    live.lowerCaseTableNames = 1;
  });
});
