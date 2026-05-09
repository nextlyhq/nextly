// F10 PR 4 — readJournal() unit tests.
//
// readJournal is a pure async function: takes a Drizzle db + dialect +
// pagination args, returns { rows, hasMore }. Tests use a fake db that
// captures the query-builder calls + returns canned rows so we can
// verify cursor pagination math + the row-shape mapping in isolation.

import { describe, expect, it } from "vitest";

import { readJournal } from "../read-journal";

interface CapturedSelect {
  from: unknown;
  where?: unknown;
  orderBy?: unknown;
  limit?: number;
  // Result the fake will return when awaited.
  result: Array<Record<string, unknown>>;
}

function makeFakeDb(returnRows: Array<Record<string, unknown>>): unknown {
  const captured: CapturedSelect = {
    from: undefined,
    result: returnRows,
  };
  // Build a chainable query-builder shape that records calls and
  // resolves to `returnRows` when awaited.
  const builder = {
    select: () => builder,
    from: (t: unknown) => {
      captured.from = t;
      return builder;
    },
    where: (clause: unknown) => {
      captured.where = clause;
      return builder;
    },
    orderBy: (clause: unknown) => {
      captured.orderBy = clause;
      return builder;
    },
    limit: (n: number) => {
      captured.limit = n;
      return Promise.resolve(returnRows);
    },
  };
  return builder;
}

const baseRow = (overrides: Record<string, unknown> = {}) => ({
  id: "id-1",
  source: "ui",
  status: "success",
  startedAt: new Date("2026-04-29T18:00:00.000Z"),
  endedAt: new Date("2026-04-29T18:00:00.500Z"),
  durationMs: 500,
  statementsPlanned: 1,
  statementsExecuted: 1,
  renamesApplied: 0,
  errorCode: null,
  errorMessage: null,
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  summaryAdded: 1,
  summaryRemoved: 0,
  summaryRenamed: 0,
  summaryChanged: 0,
  ...overrides,
});

describe("readJournal", () => {
  it("returns up to `limit` rows with hasMore=false when fewer rows exist", async () => {
    const db = makeFakeDb([baseRow({ id: "a" }), baseRow({ id: "b" })]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.rows[0].id).toBe("a");
  });

  it("returns exactly `limit` rows with hasMore=true when more exist", async () => {
    // Fake returns limit+1 rows so the function detects there's more.
    const db = makeFakeDb([
      baseRow({ id: "a" }),
      baseRow({ id: "b" }),
      baseRow({ id: "c" }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 2,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.rows.map(r => r.id)).toEqual(["a", "b"]);
  });

  it("clamps limit to the [1, 100] range", async () => {
    const db = makeFakeDb([]);

    // Out-of-range high → clamped to 100. The fake records limit+1.
    let result = await readJournal({ db, dialect: "postgresql", limit: 9999 });
    expect(result.rows).toEqual([]);

    // Out-of-range low → clamped to 1.
    result = await readJournal({ db, dialect: "postgresql", limit: 0 });
    expect(result.rows).toEqual([]);
  });

  it("returns empty result when DB has no rows", async () => {
    const db = makeFakeDb([]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("maps DB columns to API shape: scope from kind+slug", async () => {
    const db = makeFakeDb([
      baseRow({ scopeKind: "collection", scopeSlug: "posts" }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].scope).toEqual({ kind: "collection", slug: "posts" });
  });

  it("maps fresh-push scope (no slug)", async () => {
    const db = makeFakeDb([
      baseRow({ scopeKind: "fresh-push", scopeSlug: null }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].scope).toEqual({ kind: "fresh-push" });
  });

  it("maps global scope (no slug)", async () => {
    const db = makeFakeDb([
      baseRow({ scopeKind: "global", scopeSlug: null }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].scope).toEqual({ kind: "global" });
  });

  it("maps null scope (legacy rows written before F10 PR 1)", async () => {
    const db = makeFakeDb([
      baseRow({ scopeKind: null, scopeSlug: null }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].scope).toBeNull();
  });

  it("maps summary as null when any summary column is null (legacy)", async () => {
    const db = makeFakeDb([
      baseRow({
        summaryAdded: null,
        summaryRemoved: null,
        summaryRenamed: null,
        summaryChanged: null,
      }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].summary).toBeNull();
  });

  it("maps populated summary into API shape", async () => {
    const db = makeFakeDb([
      baseRow({
        summaryAdded: 1,
        summaryRemoved: 0,
        summaryRenamed: 1,
        summaryChanged: 0,
      }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].summary).toEqual({
      added: 1,
      removed: 0,
      renamed: 1,
      changed: 0,
    });
  });

  it("converts Date columns to ISO strings", async () => {
    const db = makeFakeDb([baseRow()]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].startedAt).toBe("2026-04-29T18:00:00.000Z");
    expect(result.rows[0].endedAt).toBe("2026-04-29T18:00:00.500Z");
  });

  it("renders endedAt as null for in-progress rows", async () => {
    const db = makeFakeDb([
      baseRow({ status: "in_progress", endedAt: null, durationMs: null }),
    ]);
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
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
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows[0].errorCode).toBe("DDL_FAILED");
    expect(result.rows[0].errorMessage).toBe("syntax error");
  });

  it("handles SQLite epoch-ms timestamps (number, not Date)", async () => {
    // SQLite stores timestamp_ms as integer epoch-ms; Drizzle returns
    // it as Date or number depending on the schema mode. Verify both.
    const epochMs = new Date("2026-04-29T18:00:00.000Z").getTime();
    const db = makeFakeDb([
      baseRow({
        startedAt: epochMs,
        endedAt: epochMs + 500,
      }),
    ]);
    const result = await readJournal({
      db,
      dialect: "sqlite",
      limit: 20,
    });
    expect(result.rows[0].startedAt).toBe("2026-04-29T18:00:00.000Z");
    expect(result.rows[0].endedAt).toBe("2026-04-29T18:00:00.500Z");
  });
});
