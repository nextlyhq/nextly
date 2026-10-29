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
        cause: null,
      })
    ).toContain("is numeric(10,2) NULL, expected float8 NULL.");
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
