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
}));
vi.mock("../../schema/pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: () => Promise.resolve({ tables: live.tables }),
}));

import { NextlyError } from "../../../errors/nextly-error";
import { refuseMixedStorage } from "../per-language-storage-layout";

const adapter = { dialect: "mysql" as const, getDrizzle: () => ({}) };
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
async function refusal(perLanguage: boolean): Promise<unknown> {
  try {
    await refuseMixedStorage(adapter, [articles], perLanguage);
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
