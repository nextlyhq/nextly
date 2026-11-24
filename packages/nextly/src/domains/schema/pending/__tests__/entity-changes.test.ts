/**
 * The changes not yet in a migration grouped by entity (`entityChangesOf`), as the development
 * server names them: a field by the name the configuration gives it, from the entity's recorded
 * settings; a table change or a translations file only where no settings change of its entity
 * names it; permissions on one line. What would separate a correct view from a broken one: a
 * column named where the field was, a table change listed again beside the field it made, a
 * first recording of settings shown as a change, an extension table dropped.
 */
import { describe, expect, it } from "vitest";

import type { Operation } from "../../pipeline/diff/types";
import { entityChangesOf } from "../entity-changes";

const owners = new Map([
  ["dc_posts", { kind: "collection" as const, slug: "posts" }],
  ["single_about", { kind: "single" as const, slug: "about" }],
]);

const addColumn = (tableName: string, name: string): Operation =>
  ({
    type: "add_column",
    tableName,
    column: { name, type: "text", nullable: true },
  }) as Operation;

describe("entityChangesOf", () => {
  it("names a field from the entity's settings, and not the column it adds as well", () => {
    expect(
      entityChangesOf({
        tables: [addColumn("dc_posts", "summary_text")],
        beside: [],
        settings: [
          {
            kind: "collection",
            slug: "posts",
            changes: [
              "description",
              "fields.summaryText (added)",
              "fields.title.type",
            ],
          },
        ],
        permissions: [],
        owners,
      })
    ).toEqual([
      {
        label: "posts",
        changes: [
          "setting description changed",
          "field summaryText added",
          "field title changed",
        ],
      },
    ]);
  });

  it("names a Single and a field group with their kind, and a removed field", () => {
    expect(
      entityChangesOf({
        tables: [],
        beside: [],
        settings: [
          { kind: "single", slug: "about", changes: ["fields.note (removed)"] },
          { kind: "fieldGroup", slug: "seo", changes: ["added"] },
        ],
        permissions: [],
        owners,
      })
    ).toEqual([
      { label: "about (single)", changes: ["field note removed"] },
      { label: "seo (field group)", changes: ["added"] },
    ]);
  });

  it("lists a table's changes where no settings change of its entity names them", () => {
    expect(
      entityChangesOf({
        tables: [
          addColumn("dc_posts", "summary"),
          addColumn("app_audit", "who"),
        ],
        beside: [{ kind: "translations column types", table: "dc_posts" }],
        // A snapshot that predates the record says only that settings are recorded.
        settings: [
          { kind: "collection", slug: "posts", changes: ["settings recorded"] },
        ],
        permissions: [],
        owners,
      })
    ).toEqual([
      {
        label: "posts",
        changes: ["column summary added", "translations column types"],
      },
      { label: "table app_audit", changes: ["column who added"] },
    ]);
  });

  it("names the permissions an owner adds and removes on one line", () => {
    expect(
      entityChangesOf({
        tables: [],
        beside: [],
        settings: [],
        permissions: [
          {
            kind: "owner",
            owner: "@acme/reports",
            added: ["export-reports"],
            removed: ["archive-reports"],
          },
        ],
        owners,
      })
    ).toEqual([
      {
        label: "permissions",
        changes: ["@acme/reports: + export-reports, - archive-reports"],
      },
    ]);
  });

  it("names nothing where nothing is pending", () => {
    expect(
      entityChangesOf({
        tables: [],
        beside: [],
        settings: [],
        permissions: [],
        owners,
      })
    ).toEqual([]);
  });
});
