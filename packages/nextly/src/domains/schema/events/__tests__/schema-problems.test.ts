/**
 * What the schema ledger says is wrong now, judged from events newest first:
 * each migration by its standing, as `migrate:status` reads the ledger, and
 * each collection by its newest schema change; and read from a real ledger,
 * each key by its own current state however many events came after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "../../../../__tests__/fixtures/db";
import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../../schemas/schema-events/types";
import {
  problemsFromNewestFirst,
  readSchemaProblems,
  SCHEMA_CHANGE_STALE_MS,
} from "../schema-problems";
import { SchemaEventsRepository } from "../schema-events-repository";

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
  endedAt: null,
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
  eventType: SchemaEventType = "ui_save",
  startedAt: Date = new Date(0)
) => ({
  eventType,
  status,
  filename: null,
  startedAt,
  endedAt: null,
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

  it("reads a migration attempt still open within the stale threshold as running, and one past it as failed", () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    const open = (filename: string, ageMs: number) => ({
      ...apply(filename, "in_progress", 0),
      startedAt: new Date(now.getTime() - ageMs),
    });
    // 🔴 Another process (a CLI, a second instance) recorded these attempts:
    // counted as failed the moment this process's boot gate settled, an
    // ordinary rolling deployment raised a critical failed-migration alert.
    expect(
      problemsFromNewestFirst(
        [
          open("0002_running.sql", 1000),
          open("0001_stale.sql", SCHEMA_CHANGE_STALE_MS + 1),
        ],
        now
      )
    ).toEqual({
      unfinishedMigrations: ["0001_stale.sql"],
      runningMigrations: ["0002_running.sql"],
      failedCollectionChanges: [],
    });
    // At the threshold itself it is still running; a failed attempt is
    // failed however recent.
    expect(
      problemsFromNewestFirst(
        [
          open("0002_edge.sql", SCHEMA_CHANGE_STALE_MS),
          {
            ...apply("0001_failed.sql", "failed", 0),
            startedAt: new Date(now.getTime() - 1000),
          },
        ],
        now
      )
    ).toMatchObject({
      unfinishedMigrations: ["0001_failed.sql"],
      runningMigrations: ["0002_edge.sql"],
    });
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
  it("names a collection whose newest change was interrupted: still open, with no end, past the stale threshold", () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    // 🔴 Marked seen and skipped as not failed, an interrupted save read as
    // healthy and hid the older failure behind it.
    expect(
      problemsFromNewestFirst(
        [
          change(
            "posts",
            "in_progress",
            "ui_save",
            ago(SCHEMA_CHANGE_STALE_MS + 1)
          ),
          change("posts", "failed", "ui_save", ago(SCHEMA_CHANGE_STALE_MS + 2)),
        ],
        now
      ).failedCollectionChanges
    ).toEqual(["posts"]);
  });

  it("reads a recently started change as running, not a problem", () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    expect(
      problemsFromNewestFirst(
        [
          change(
            "posts",
            "in_progress",
            "dev_push",
            new Date(now.getTime() - 1000)
          ),
          change("posts", "failed", "ui_save", new Date(now.getTime() - 2000)),
        ],
        now
      ).failedCollectionChanges
    ).toEqual([]);
  });
});

describe("schema problems, read from the ledger", () => {
  let ledger: SchemaEventsRepository;
  let db: unknown;
  const BASE = Date.parse("2026-10-01T00:00:00.000Z");
  const at = (minutes: number) => new Date(BASE + minutes * 60_000);

  beforeEach(async () => {
    db = (await createTestDb()).db;
    ledger = new SchemaEventsRepository(db, "sqlite");
  });

  const insert = (values: Record<string, unknown>) =>
    ledger.insertEvent({ source: "cli-migrate", ...values });

  const read = (now: Date = at(10_000)) =>
    readSchemaProblems({ db, dialect: "sqlite", now });

  it("finds an older unresolved failure behind 600 newer unrelated events", async () => {
    await insert({
      eventType: "file_apply",
      status: "failed",
      filename: "0001_old.sql",
      startedAt: at(0),
    });
    await insert({
      eventType: "ui_save",
      source: "admin-ui",
      status: "failed",
      scopeKind: "collection",
      scopeSlug: "posts",
      startedAt: at(1),
    });
    // 🔴 Read from a window of the 500 newest events, these pushed both
    // failures out of it, and the install read as healthy.
    for (let i = 0; i < 600; i += 1) {
      await insert(
        i % 2 === 0
          ? {
              eventType: "file_apply",
              status: "applied",
              filename: `1${String(i).padStart(4, "0")}_new.sql`,
              startedAt: at(10 + i),
            }
          : {
              eventType: "ui_save",
              source: "admin-ui",
              status: "applied",
              scopeKind: "collection",
              scopeSlug: "pages",
              startedAt: at(10 + i),
            }
      );
    }
    expect(await read()).toEqual({
      unfinishedMigrations: ["0001_old.sql"],
      runningMigrations: [],
      failedCollectionChanges: ["posts"],
    });
  });

  it("leaves out a failure its own key resolved since, however far back", async () => {
    await insert({
      eventType: "file_apply",
      status: "failed",
      filename: "0001_a.sql",
      startedAt: at(0),
    });
    await insert({
      eventType: "file_apply",
      status: "applied",
      filename: "0001_a.sql",
      startedAt: at(1),
    });
    await insert({
      eventType: "ui_save",
      source: "admin-ui",
      status: "failed",
      scopeKind: "collection",
      scopeSlug: "posts",
      startedAt: at(2),
    });
    await insert({
      eventType: "dev_push",
      source: "dev-server",
      status: "applied",
      scopeKind: "collection",
      scopeSlug: "posts",
      startedAt: at(3),
    });
    expect(await read()).toEqual({
      unfinishedMigrations: [],
      runningMigrations: [],
      failedCollectionChanges: [],
    });
  });

  it("names an interrupted schema change, and not one still running", async () => {
    await insert({
      eventType: "ui_save",
      source: "admin-ui",
      status: "in_progress",
      scopeKind: "collection",
      scopeSlug: "posts",
      startedAt: at(0),
    });
    // Ten minutes and a moment on: interrupted.
    expect(
      (await read(new Date(at(0).getTime() + SCHEMA_CHANGE_STALE_MS + 1)))
        .failedCollectionChanges
    ).toEqual(["posts"]);
    // A minute on: still running.
    expect((await read(at(1))).failedCollectionChanges).toEqual([]);
  });

  describe("a failed change and its retry in the same millisecond", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reads the retry as newer, so it resolves the failure", async () => {
      // Every clock read returns the same millisecond: the save, its failure,
      // the retry and its success all happen "at once".
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at(0));
      const scope = {
        eventType: "ui_save" as const,
        source: "admin-ui" as const,
        scopeKind: "collection" as const,
        scopeSlug: "posts",
      };
      const failed = await ledger.recordStart(scope);
      await ledger.markFailed(failed, { errorCode: "TEST" });
      // The control: the failure alone is the collection's problem.
      expect((await read(at(1))).failedCollectionChanges).toEqual(["posts"]);

      const retry = await ledger.recordStart(scope);
      await ledger.markApplied(retry, {});

      // 🔴 Stamped with the same startedAt, the strict "started after"
      // comparison did not see the retry as newer, and the failure stayed in
      // System health for good.
      const first = await ledger.findById(failed);
      const second = await ledger.findById(retry);
      expect(
        new Date(second?.startedAt ?? 0).getTime() -
          new Date(first?.startedAt ?? 0).getTime()
      ).toBeGreaterThan(0);
      expect((await read(at(1))).failedCollectionChanges).toEqual([]);
    });

    it("still names a failure recorded after a success in the same millisecond", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at(0));
      const scope = {
        eventType: "ui_save" as const,
        source: "admin-ui" as const,
        scopeKind: "collection" as const,
        scopeSlug: "posts",
      };
      const applied = await ledger.recordStart(scope);
      await ledger.markApplied(applied, {});
      const failed = await ledger.recordStart(scope);
      await ledger.markFailed(failed, { errorCode: "TEST" });
      expect((await read(at(1))).failedCollectionChanges).toEqual(["posts"]);
    });
  });
});
