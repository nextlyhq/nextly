import { describe, expect, it } from "vitest";

import type {
  ColumnFinding,
  ColumnLocation,
} from "../../../domains/schema/repair-columns/types";
import { formatFinding } from "../repair-columns";

const location: ColumnLocation = {
  kind: "collection",
  slug: "posts",
  field: "links",
  table: "dc_posts",
  column: "links",
  translation: false,
};

describe("formatFinding", () => {
  it("names the entity, field, column, both states and a legacy cause", () => {
    const line = formatFinding({
      kind: "differs",
      location,
      expected: { type: "jsonb", nullable: true },
      live: { type: "text", nullable: true },
      aspects: { type: true, nullability: false },
      conversion: null,
      judgement: null,
      cause: {
        kind: "legacy",
        shape: "structured-as-text",
        before: "0.0.2-alpha.67",
      },
    });
    expect(line).toBe(
      'collection "posts", field "links" (dc_posts.links): is text NULL, expected jsonb NULL; created before 0.0.2-alpha.67.'
    );
  });

  it("names a column a current generator still creates", () => {
    expect(
      formatFinding({
        kind: "differs",
        location: { ...location, field: "author", column: "author" },
        expected: { type: "text", nullable: true },
        live: { type: "text", nullable: false },
        aspects: { type: false, nullability: true },
        conversion: null,
        judgement: null,
        cause: { kind: "current-generator" },
      })
    ).toContain(
      "is text NOT NULL, expected text NULL; created by the current version's generator."
    );
  });

  it("prints a size PostgreSQL reports beside the type", () => {
    expect(
      formatFinding({
        kind: "differs",
        location,
        expected: { type: "float8", nullable: true },
        live: { type: "numeric", nullable: true, typeModifier: "10,2" },
        aspects: { type: true, nullability: false },
        conversion: null,
        judgement: null,
        cause: null,
      })
    ).toContain("is numeric(10,2) NULL, expected float8 NULL.");
  });

  it("gives a difference's class, and each reason with its rows by key", () => {
    const differs: ColumnFinding = {
      kind: "differs",
      location,
      expected: { type: "jsonb", nullable: false },
      live: { type: "text", nullable: true },
      aspects: { type: true, nullability: true },
      conversion: null,
      cause: null,
      judgement: { class: "safe", reasons: [] },
    };
    expect(formatFinding(differs)).toBe(
      'collection "posts", field "links" (dc_posts.links): is text NULL, expected jsonb NOT NULL. safe.'
    );

    const blocked = formatFinding({
      ...differs,
      location: { ...location, table: "dc_posts_locales", translation: true },
      judgement: {
        class: "blocked",
        reasons: [
          {
            kind: "not-json",
            class: "lossy",
            rows: {
              first: [
                { parent: "p1", locale: "en" },
                { parent: "p1", locale: "fr" },
              ],
              count: 25,
            },
          },
          {
            kind: "null-under-not-null",
            class: "blocked",
            rows: { first: [{ parent: "p2", locale: "en" }], count: 1 },
          },
        ],
      },
    });
    expect(blocked).toContain(
      "blocked: values that do not parse as JSON would be cleared (25 rows, first 2: parent p1 locale en, parent p1 locale fr); rows hold a null where the column is to be NOT NULL (1 row: parent p2 locale en)."
    );
  });

  it("gives a reason the pair of types gives with no rows", () => {
    expect(
      formatFinding({
        kind: "differs",
        location,
        expected: { type: "double", nullable: true },
        live: { type: "bigint", nullable: true },
        aspects: { type: true, nullability: false },
        conversion: null,
        cause: null,
        judgement: {
          class: "blocked",
          reasons: [{ kind: "late-write", class: "blocked" }],
        },
      })
    ).toMatch(
      /blocked: MySQL checks the rows and changes the column in separate transactions, so a value written meanwhile could be changed with no error\.$/
    );
  });

  // Rows that all convert do not make a column safe when its conversion would drop something the
  // new type cannot keep: the class is blocked, and the line says what and what the owner can do.
  it("blocks a difference whose new type cannot keep a view, naming it and the owner's change", () => {
    const line = formatFinding({
      kind: "differs",
      location,
      expected: { type: "jsonb", nullable: true },
      live: { type: "text", nullable: true },
      aspects: { type: true, nullability: false },
      cause: null,
      judgement: { class: "safe", reasons: [] },
      conversion: {
        steps: [],
        rewritesTable: true,
        blocks: "reads-and-writes",
        cannotCarry: [
          {
            property: "view",
            name: "posts_summary",
            reason:
              "PostgreSQL refuses to change the type of a column a view reads",
            ownerCan:
              "drop the view, convert the column, then create the view again",
          },
        ],
        notCarried: [],
      },
    });
    expect(line).toMatch(
      /\. blocked: cannot keep the view "posts_summary": PostgreSQL refuses to change the type of a column a view reads; drop the view, convert the column, then create the view again\. Converting it rewrites the table; reads and writes of the table wait until it ends\.$/
    );
  });

  it("names a collation and a character set the new type has no place for, without blocking", () => {
    const line = formatFinding({
      kind: "differs",
      location,
      expected: { type: "json", nullable: true },
      live: { type: "text", nullable: true },
      aspects: { type: true, nullability: false },
      cause: null,
      judgement: { class: "safe", reasons: [] },
      conversion: {
        steps: [],
        rewritesTable: true,
        blocks: "writes",
        cannotCarry: [],
        notCarried: [
          { property: "characterSet", value: "latin1" },
          { property: "collation", value: "latin1_bin" },
        ],
      },
    });
    expect(line).toMatch(
      /\. safe\. Not carried, since the new type has no place for it: character set latin1, collation latin1_bin\. Converting it rewrites the table; reads continue and writes wait until it ends\.$/
    );
  });

  it("points a column that is not migrated to nextly migrate", () => {
    const missing: ColumnFinding = {
      kind: "not-migrated",
      location,
      missing: "table",
      expected: { type: "jsonb", nullable: true },
    };
    expect(formatFinding(missing)).toBe(
      'collection "posts", field "links" (dc_posts.links): not migrated, the table does not exist (expected jsonb NULL). Run `nextly migrate`.'
    );
  });

  it("points a pending change to migrate:create and nextly migrate", () => {
    expect(
      formatFinding({
        kind: "pending-migration",
        location,
        applied: { type: "int4", nullable: true },
        configured: null,
        live: { type: "int4", nullable: true },
      })
    ).toBe(
      'collection "posts", field "links" (dc_posts.links): pending a migration, int4 NULL as applied, removed as configured. Run `nextly migrate:create`, then `nextly migrate`.'
    );
  });

  it("names the plugin that owns a column and says it is never changed here", () => {
    expect(
      formatFinding({
        kind: "differs",
        location,
        plugin: "seo-kit",
        expected: { type: "jsonb", nullable: true },
        live: { type: "text", nullable: true },
        aspects: { type: true, nullability: false },
        conversion: null,
        judgement: null,
        cause: null,
      })
    ).toMatch(/Owned by plugin "seo-kit"; reported, never changed here\.$/);
  });

  it("marks a translation table and names user fields without a slug", () => {
    expect(
      formatFinding({
        kind: "not-migrated",
        location: {
          kind: "userFields",
          slug: "users",
          field: "score",
          table: "user_ext",
          column: "score",
          translation: false,
        },
        missing: "column",
        expected: { type: "float4", nullable: true },
      })
    ).toMatch(/^user fields, field "score" \(user_ext\.score\)/);
    expect(
      formatFinding({
        kind: "not-migrated",
        location: { ...location, table: "dc_posts_locales", translation: true },
        missing: "column",
        expected: { type: "text", nullable: true },
      })
    ).toContain("(dc_posts_locales.links, translation table)");
  });
});
