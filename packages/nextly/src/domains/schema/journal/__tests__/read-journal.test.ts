// Plan C1 — readJournal() reads from `nextly_schema_events`.
//
// readJournal is a pure async function: takes a Drizzle db + dialect +
// pagination args, returns { rows, hasMore }. Tests use a fake db that
// captures the query-builder calls + returns canned events rows so we can
// verify cursor pagination math + the events→API row mapping in isolation.

import { describe, expect, it } from "vitest";

import { readJournal } from "../read-journal";

function makeFakeDb(returnRows: Array<Record<string, unknown>>): unknown {
  // Chainable query-builder shape that resolves to `returnRows` when awaited.
  const builder = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: (_n: number) => Promise.resolve(returnRows),
  };
  return builder;
}

// A `nextly_schema_events` row as Drizzle returns it (camelCase).
const baseRow = (overrides: Record<string, unknown> = {}) => ({
  id: "id-1",
  eventType: "ui_save" as const,
  status: "applied" as const,
  source: "admin-ui" as const,
  startedAt: new Date("2026-04-29T18:00:00.000Z"),
  endedAt: new Date("2026-04-29T18:00:00.500Z"),
  durationMs: 500,
  statementsExecuted: 1,
  renamesApplied: 0,
  errorCode: null,
  errorMessage: null,
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  ...overrides,
});

describe("readJournal", () => {
  it("returns up to `limit` rows with hasMore=false when fewer rows exist", async () => {
    const db = makeFakeDb([baseRow({ id: "a" }), baseRow({ id: "b" })]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.rows[0].id).toBe("a");
  });

  it("returns exactly `limit` rows with hasMore=true when more exist", async () => {
    const db = makeFakeDb([
      baseRow({ id: "a" }),
      baseRow({ id: "b" }),
      baseRow({ id: "c" }),
    ]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.rows.map(r => r.id)).toEqual(["a", "b"]);
  });

  it("clamps limit to the [1, 100] range", async () => {
    const db = makeFakeDb([]);
    let result = await readJournal({ db, dialect: "postgresql", limit: 9999 });
    expect(result.rows).toEqual([]);
    result = await readJournal({ db, dialect: "postgresql", limit: 0 });
    expect(result.rows).toEqual([]);
  });

  it("returns empty result when DB has no rows", async () => {
    const db = makeFakeDb([]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("maps eventType=ui_save → source=ui, dev_push → source=code", async () => {
    let db = makeFakeDb([baseRow({ eventType: "ui_save" })]);
    let result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].source).toBe("ui");

    db = makeFakeDb([baseRow({ eventType: "dev_push" })]);
    result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].source).toBe("code");
  });

  it("maps status: applied→success, failed→failed, in_progress→in_progress, superseded→aborted", async () => {
    const cases: Array<[string, string]> = [
      ["applied", "success"],
      ["failed", "failed"],
      ["in_progress", "in_progress"],
      ["superseded", "aborted"],
    ];
    for (const [eventStatus, apiStatus] of cases) {
      const db = makeFakeDb([baseRow({ status: eventStatus })]);
      const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
      expect(result.rows[0].status).toBe(apiStatus);
    }
  });

  it("maps scope from kind+slug", async () => {
    const db = makeFakeDb([
      baseRow({ scopeKind: "collection", scopeSlug: "posts" }),
    ]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].scope).toEqual({ kind: "collection", slug: "posts" });
  });

  it("maps global scope (no slug)", async () => {
    const db = makeFakeDb([baseRow({ scopeKind: "global", scopeSlug: null })]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].scope).toEqual({ kind: "global" });
  });

  it("folds events-only scope kinds (core/component) into global", async () => {
    const db = makeFakeDb([baseRow({ scopeKind: "core", scopeSlug: null })]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].scope).toEqual({ kind: "global" });
  });

  it("maps null scope to null", async () => {
    const db = makeFakeDb([baseRow({ scopeKind: null, scopeSlug: null })]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].scope).toBeNull();
  });

  it("always returns summary=null (events table does not persist per-kind counts)", async () => {
    const db = makeFakeDb([baseRow()]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].summary).toBeNull();
  });

  it("converts Date columns to ISO strings", async () => {
    const db = makeFakeDb([baseRow()]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].startedAt).toBe("2026-04-29T18:00:00.000Z");
    expect(result.rows[0].endedAt).toBe("2026-04-29T18:00:00.500Z");
  });

  it("renders endedAt as null for in-progress rows", async () => {
    const db = makeFakeDb([
      baseRow({ status: "in_progress", endedAt: null, durationMs: null }),
    ]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].status).toBe("in_progress");
    expect(result.rows[0].endedAt).toBeNull();
    expect(result.rows[0].durationMs).toBeNull();
  });

  it("propagates errorCode + errorMessage on failed rows", async () => {
    const db = makeFakeDb([
      baseRow({
        status: "failed",
        errorCode: "DDL_FAILED",
        errorMessage: "syntax error",
      }),
    ]);
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows[0].errorCode).toBe("DDL_FAILED");
    expect(result.rows[0].errorMessage).toBe("syntax error");
  });

  it("handles SQLite epoch-ms timestamps (number, not Date)", async () => {
    const epochMs = new Date("2026-04-29T18:00:00.000Z").getTime();
    const db = makeFakeDb([
      baseRow({ startedAt: epochMs, endedAt: epochMs + 500 }),
    ]);
    const result = await readJournal({ db, dialect: "sqlite", limit: 20 });
    expect(result.rows[0].startedAt).toBe("2026-04-29T18:00:00.000Z");
    expect(result.rows[0].endedAt).toBe("2026-04-29T18:00:00.500Z");
  });
});
