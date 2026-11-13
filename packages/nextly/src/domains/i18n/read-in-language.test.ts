/**
 * The language a public read asks in admits what the read's lifecycle bound
 * admits: every state the workflow calls public, and the documents a due
 * release reveals. Rendered to SQL, so the states and ids it is built from are
 * the parameters the database receives.
 */
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { publishedInLanguageCondition } from "./read-in-language";
import type { CompanionSchema } from "./runtime/companion-io";

const companion = {
  companionTableName: "dc_posts_locales",
  localizedFields: [{ name: "title", column: "title" }],
  hasStatus: true,
  hasUpdatedAt: true,
  table: undefined,
} as unknown as CompanionSchema;

const rendered = (
  args: Partial<Parameters<typeof publishedInLanguageCondition>[0]>
) => {
  const condition = publishedInLanguageCondition({
    companion,
    statusFilter: { values: ["published"], isPublicRead: true },
    localeChain: ["es", "en"],
    mainIdColumn: sql.identifier("id"),
    defaultLocale: "en",
    ...args,
  });
  if (condition === undefined) throw new Error("no condition");
  return new PgDialect().sqlToQuery(condition);
};

describe("publishedInLanguageCondition", () => {
  it("counts every state the read calls public", () => {
    const query = rendered({
      statusFilter: { values: ["published", "featured"], isPublicRead: true },
    });
    expect(query.params).toEqual(
      expect.arrayContaining(["es", "published", "featured"])
    );
  });

  it("admits a document a due release reveals, beside those published in the language", () => {
    const query = rendered({ revealed: ["doc-1"] });
    expect(query.params).toEqual(
      expect.arrayContaining(["published", "doc-1"])
    );
    expect(query.sql).toMatch(/ OR "id" IN \(\$\d+\)/);
  });

  it("keeps nothing out of a read that is not public", () => {
    expect(
      publishedInLanguageCondition({
        companion,
        statusFilter: { values: ["draft"], isPublicRead: false },
        localeChain: ["es"],
        mainIdColumn: sql.identifier("id"),
        defaultLocale: "en",
      })
    ).toBeUndefined();
  });
});
