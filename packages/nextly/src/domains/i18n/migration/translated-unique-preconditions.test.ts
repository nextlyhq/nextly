import { describe, expect, it } from "vitest";

import { companionUniqueIndexName } from "./companion-unique-indexes";
import {
  refusalsForUnindexableTranslatedUnique,
  refuseUnindexableTranslatedUnique,
  withoutAlreadyInstalledIndexes,
} from "./translated-unique-preconditions";

/** An adapter that only answers what the server can do, which is all these refusals read. */
const serverThat = (
  dialect: "postgresql" | "mysql" | "sqlite",
  functionalIndexes = true
) => ({
  getCapabilities: () => ({ dialect, functionalIndexes }) as never,
});

describe("what a server can carry a translated unique field on", () => {
  it("refuses a column the dialect cannot key at all, keyed as it is", () => {
    const refusals = refusalsForUnindexableTranslatedUnique(
      serverThat("mysql"),
      [{ field: "payload", column: "payload", text: false, kind: "json" }]
    );
    expect(refusals.map(r => r.path)).toEqual(["fields.payload"]);
    expect(refusals[0]?.code).toBe("UNIQUE_NOT_ENFORCEABLE_ON_DIALECT");
  });

  it("allows the same field where the dialect can key its column", () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      expect(
        refusalsForUnindexableTranslatedUnique(serverThat(dialect), [
          { field: "payload", column: "payload", text: false, kind: "json" },
        ])
      ).toEqual([]);
    }
  });

  it("still allows the ordinary non-text columns on every dialect", () => {
    for (const kind of ["integer", "boolean", "timestamp", "fkSingle"] as const)
      expect(
        refusalsForUnindexableTranslatedUnique(serverThat("mysql"), [
          { field: "rank", column: "rank", text: false, kind },
        ])
      ).toEqual([]);
  });

  it("refuses a text column only where the server cannot key an expression", () => {
    const column = {
      field: "slug",
      column: "slug",
      text: true,
      kind: "text",
    } as const;
    expect(
      refusalsForUnindexableTranslatedUnique(serverThat("mysql", false), [
        column,
      ]).map(r => r.code)
    ).toEqual(["UNIQUE_NOT_ENFORCEABLE_ON_DIALECT"]);
    expect(
      refusalsForUnindexableTranslatedUnique(serverThat("mysql", true), [
        column,
      ])
    ).toEqual([]);
  });

  it("refuses the unindexable column of a save that marks one unique, before anything runs", () => {
    let thrown: unknown;
    try {
      refuseUnindexableTranslatedUnique(serverThat("mysql"), {
        entity: "posts",
        builtBy: "collection",
        oldFields: [],
        newFields: [
          { name: "payload", type: "json", unique: true, localized: true },
        ],
        wasLocalized: true,
        isLocalized: true,
      });
    } catch (error) {
      thrown = error;
    }
    const errors = (
      thrown as {
        publicData?: { errors?: { path: string; code: string }[] };
      }
    ).publicData?.errors;
    expect(errors?.map(e => [e.path, e.code])).toEqual([
      ["fields.payload", "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT"],
    ]);
  });
});

describe("a unique file meeting a database that already has the index", () => {
  const slug = companionUniqueIndexName("dc_posts_locales", "slug");
  const rank = companionUniqueIndexName("dc_posts_locales", "rank");

  it("leaves out the create of an index already installed, whatever the dialect spells it", () => {
    const statements = [
      `CREATE UNIQUE INDEX \`${slug}\` ON \`dc_posts_locales\` ((SHA2(WEIGHT_STRING(NULLIF(\`slug\`, '')), 256)), \`_locale\`)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "${rank}" ON "dc_posts_locales" ("rank", "_locale")`,
    ];
    expect(withoutAlreadyInstalledIndexes(statements, new Set([slug]))).toEqual(
      [statements[1]]
    );
  });

  it("keeps every statement when the database holds none of them", () => {
    const statements = [
      `CREATE UNIQUE INDEX \`${slug}\` ON \`dc_posts_locales\` (\`slug\`, \`_locale\`)`,
    ];
    expect(withoutAlreadyInstalledIndexes(statements, new Set())).toEqual(
      statements
    );
  });

  it("never drops a statement that is not creating one of those indexes", () => {
    const statements = [
      `DROP INDEX \`${slug}\` ON \`dc_posts_locales\``,
      `ALTER TABLE \`dc_posts_locales\` ADD COLUMN \`slug\` VARCHAR(255)`,
    ];
    expect(withoutAlreadyInstalledIndexes(statements, new Set([slug]))).toEqual(
      statements
    );
  });
});
