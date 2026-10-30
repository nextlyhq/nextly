/**
 * What the schema ledger says is wrong now, judged from events newest first:
 * each migration by its standing, as `migrate:status` reads the ledger, and
 * each collection by its newest schema change.
 */
import { describe, expect, it } from "vitest";

import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../../schemas/schema-events/types";
import { problemsFromNewestFirst } from "../schema-problems";

/**
 * A migration's record, `at` seconds in. Newest first is the reader's order,
 * so each case lists its events that way, and their times say so too.
 */
const record = (
  eventType: SchemaEventType,
  filename: string,
  status: SchemaEventStatus,
  at: number,
  supersededEventIds: string[] | null = null
) => ({
  eventType,
  status,
  filename,
  startedAt: new Date(at * 1000),
  supersededEventIds,
  scopeKind: null,
  scopeSlug: null,
});
const apply = (filename: string, status: SchemaEventStatus, at: number) =>
  record("file_apply", filename, status, at);
const rollback = (filename: string, status: SchemaEventStatus, at: number) =>
  record("file_rollback", filename, status, at);

const change = (
  slug: string,
  status: SchemaEventStatus,
  eventType: SchemaEventType = "ui_save"
) => ({
  eventType,
  status,
  filename: null,
  startedAt: new Date(0),
  supersededEventIds: null,
  scopeKind: "collection",
  scopeSlug: slug,
});

const unfinished = (events: Parameters<typeof problemsFromNewestFirst>[0]) =>
  problemsFromNewestFirst(events).unfinishedMigrations;

describe("schema problems", () => {
  it("names a migration whose apply failed or never finished, the most recent first", () => {
    expect(
      unfinished([
        apply("0003_c.sql", "in_progress", 3),
        apply("0002_b.sql", "failed", 2),
        apply("0001_a.sql", "applied", 1),
      ])
    ).toEqual(["0003_c.sql", "0002_b.sql"]);
  });

  it("leaves out a failure a later apply superseded", () => {
    expect(
      unfinished([
        apply("0002_b.sql", "applied", 2),
        apply("0002_b.sql", "failed", 1),
      ])
    ).toEqual([]);
  });

  it("leaves out a failure migrate:resolve cleared, and one an attempt that applied nothing ended", () => {
    // Cleared: flipped to rolled_back in place, retiring nothing.
    expect(
      unfinished([record("file_apply", "0002_b.sql", "rolled_back", 1, [])])
    ).toEqual([]);
    expect(
      unfinished([
        apply("0003_c.sql", "nothing_applied", 2),
        apply("0003_c.sql", "failed", 1),
      ])
    ).toEqual([]);
  });

  it("names an applied migration whose migrate:down failed, though it is still applied", () => {
    // 🔴 Judged by its newest apply alone, the migration read as up to date:
    // migrate:status warns that its rollback failed, and on MySQL, or outside
    // a transaction, part of the DOWN may have committed.
    expect(
      unfinished([
        rollback("0001_a.sql", "failed", 2),
        apply("0001_a.sql", "applied", 1),
      ])
    ).toEqual(["0001_a.sql"]);
    // A rollback that stopped with no outcome is one too.
    expect(
      unfinished([
        rollback("0001_a.sql", "in_progress", 2),
        apply("0001_a.sql", "applied", 1),
      ])
    ).toEqual(["0001_a.sql"]);
  });

  it("leaves out a failed migrate:down a later rollback finished", () => {
    expect(
      unfinished([
        record("file_apply", "0001_a.sql", "rolled_back", 3, ["applied-1"]),
        rollback("0001_a.sql", "failed", 2),
        apply("0001_a.sql", "applied", 1),
      ])
    ).toEqual([]);
  });

  it("judges a plugin's module by its stream's own rule, its newest records", () => {
    expect(
      unfinished([
        apply("plugin:acme/0002_b", "failed", 2),
        apply("plugin:acme/0001_a", "applied", 1),
      ])
    ).toEqual(["plugin:acme/0002_b"]);
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
