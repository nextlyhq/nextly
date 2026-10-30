/**
 * What the schema ledger says is wrong now, judged from events newest first:
 * each migration file and each collection by its newest event alone.
 */
import { describe, expect, it } from "vitest";

import { problemsFromNewestFirst } from "../schema-problems";

const file = (filename: string, status: string) => ({
  eventType: "file_apply",
  status,
  filename,
  scopeKind: null,
  scopeSlug: null,
});

const change = (slug: string, status: string, eventType = "ui_save") => ({
  eventType,
  status,
  filename: null,
  scopeKind: "collection",
  scopeSlug: slug,
});

describe("schema problems", () => {
  it("names a migration whose newest attempt failed or never finished", () => {
    expect(
      problemsFromNewestFirst([
        file("0003_c.sql", "in_progress"),
        file("0002_b.sql", "failed"),
        file("0001_a.sql", "applied"),
      ]).unfinishedMigrations
    ).toEqual(["0003_c.sql", "0002_b.sql"]);
  });

  it("leaves out a migration whose failure a newer apply superseded", () => {
    // Newest first: applied after it failed, so nothing is wrong now.
    expect(
      problemsFromNewestFirst([
        file("0002_b.sql", "applied"),
        file("0002_b.sql", "failed"),
      ]).unfinishedMigrations
    ).toEqual([]);
  });

  it("names a collection whose newest schema change failed, and not one fixed since", () => {
    expect(
      problemsFromNewestFirst([
        change("posts", "failed"),
        change("pages", "applied", "dev_push"),
        change("pages", "failed"),
        change("posts", "applied"),
      ]).failedCollectionChanges
    ).toEqual(["posts"]);
  });

  it("reads a Single's or a component's change as no collection's", () => {
    expect(
      problemsFromNewestFirst([
        { ...change("home", "failed"), scopeKind: "single" },
      ]).failedCollectionChanges
    ).toEqual([]);
  });
});
