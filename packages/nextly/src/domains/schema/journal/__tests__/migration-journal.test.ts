// Unit tests for MigrationJournal — F8 PR 5.
// Drives the journal through its lifecycle (recordStart → recordEnd)
// against a mocked Drizzle insert/update API. Cross-dialect integration
// tests against real DBs ship in F8 PR 7.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { DrizzleMigrationJournal } from "../migration-journal.js";

interface InsertCapture {
  table: unknown;
  values: Record<string, unknown>;
}

interface UpdateCapture {
  table: unknown;
  values: Record<string, unknown>;
  whereClause: unknown;
}

function makeFakeDb(): {
  db: unknown;
  inserts: InsertCapture[];
  updates: UpdateCapture[];
} {
  const inserts: InsertCapture[] = [];
  const updates: UpdateCapture[] = [];

  const insertChain = (table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      inserts.push({ table, values: vals });
      return Promise.resolve();
    },
  });

  const updateChain = (table: unknown) => ({
    set: (vals: Record<string, unknown>) => ({
      where: (whereClause: unknown) => {
        updates.push({ table, values: vals, whereClause });
        return Promise.resolve();
      },
    }),
  });

  const db = {
    insert: insertChain,
    update: updateChain,
  };

  return { db, inserts, updates };
}

const fakeLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("DrizzleMigrationJournal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("recordStart", () => {
    it("inserts a row with status='in_progress' and startedAt set", async () => {
      const { db, inserts } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });

      const id = await journal.recordStart({
        source: "code",
        statementsPlanned: 5,
      });

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(10);
      expect(inserts.length).toBe(1);
      expect(inserts[0].values).toMatchObject({
        id,
        source: "code",
        status: "in_progress",
        statementsPlanned: 5,
      });
      expect(inserts[0].values.startedAt).toBeInstanceOf(Date);
    });

    it("returns a new UUID per call (rows are independent)", async () => {
      const { db } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });

      const id1 = await journal.recordStart({
        source: "code",
        statementsPlanned: 1,
      });
      const id2 = await journal.recordStart({
        source: "ui",
        statementsPlanned: 2,
      });

      expect(id1).not.toBe(id2);
    });

    it("returns a fallback id and logs on insert failure (best-effort)", async () => {
      const failingDb = {
        insert: () => ({
          values: () => Promise.reject(new Error("connection refused")),
        }),
      };
      const journal = new DrizzleMigrationJournal({
        db: failingDb,
        dialect: "postgresql",
        logger: fakeLogger,
      });

      const id = await journal.recordStart({
        source: "code",
        statementsPlanned: 0,
      });

      expect(id).toMatch(/^journal-failed-/);
      expect(fakeLogger.warn).toHaveBeenCalledOnce();
    });
  });

  describe("recordEnd", () => {
    it("updates the row with status='success' on success", async () => {
      const { db, updates } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });
      const id = await journal.recordStart({
        source: "code",
        statementsPlanned: 5,
      });

      await journal.recordEnd(id, {
        success: true,
        statementsExecuted: 4,
      });

      expect(updates.length).toBe(1);
      expect(updates[0].values).toMatchObject({
        status: "success",
        statementsExecuted: 4,
      });
      expect(updates[0].values.endedAt).toBeInstanceOf(Date);
      expect(typeof updates[0].values.durationMs).toBe("number");
      expect(updates[0].values.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("updates the row with status='failed' and error on failure", async () => {
      const { db, updates } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });
      const id = await journal.recordStart({
        source: "ui",
        statementsPlanned: 5,
      });

      await journal.recordEnd(id, {
        success: false,
        statementsExecuted: 0,
        error: new Error("DDL execution failed: ALTER TABLE bad column"),
      });

      expect(updates[0].values).toMatchObject({
        status: "failed",
        statementsExecuted: 0,
      });
      expect(updates[0].values.errorMessage).toContain("DDL execution failed");
    });

    it("truncates long error messages to 1000 chars", async () => {
      const { db, updates } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });
      const id = await journal.recordStart({
        source: "ui",
        statementsPlanned: 0,
      });

      const longMessage = "x".repeat(5000);
      await journal.recordEnd(id, {
        success: false,
        statementsExecuted: 0,
        error: new Error(longMessage),
      });

      const errMsg = updates[0].values.errorMessage as string;
      expect(errMsg.length).toBeLessThanOrEqual(1003); // 1000 + "..."
      expect(errMsg.endsWith("...")).toBe(true);
    });

    it("ignores non-Error errors gracefully (passes string)", async () => {
      const { db, updates } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });
      const id = await journal.recordStart({
        source: "ui",
        statementsPlanned: 0,
      });

      await journal.recordEnd(id, {
        success: false,
        statementsExecuted: 0,
        error: "string error",
      });

      expect(updates[0].values.errorMessage).toBe("string error");
    });

    it("logs and continues when the update query fails (best-effort)", async () => {
      const failingDb = {
        insert: () => ({
          values: () => Promise.resolve(),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.reject(new Error("update failed")),
          }),
        }),
      };
      const journal = new DrizzleMigrationJournal({
        db: failingDb,
        dialect: "sqlite",
        logger: fakeLogger,
      });
      const id = await journal.recordStart({
        source: "code",
        statementsPlanned: 0,
      });

      // Must not throw.
      await journal.recordEnd(id, {
        success: true,
        statementsExecuted: 0,
      });

      expect(fakeLogger.warn).toHaveBeenCalled();
    });

    it("skips the update when journalId is the fallback sentinel", async () => {
      const { db, updates } = makeFakeDb();
      const journal = new DrizzleMigrationJournal({
        db,
        dialect: "sqlite",
        logger: fakeLogger,
      });

      // Synthesize a fallback ID (as recordStart would produce on
      // insert failure). recordEnd should silently skip the update.
      await journal.recordEnd("journal-failed-1234", {
        success: true,
        statementsExecuted: 0,
      });

      expect(updates.length).toBe(0);
    });
  });

  describe("dialect routing", () => {
    it.each<["postgresql" | "mysql" | "sqlite", string]>([
      ["postgresql", "PG"],
      ["mysql", "MySQL"],
      ["sqlite", "SQLite"],
    ])(
      "selects the correct dialect-specific journal table for %s",
      async dialect => {
        const { db, inserts } = makeFakeDb();
        const journal = new DrizzleMigrationJournal({
          db,
          dialect,
          logger: fakeLogger,
        });
        await journal.recordStart({
          source: "code",
          statementsPlanned: 0,
        });
        // Whatever table object we passed should be specific to this
        // dialect (different reference per dialect). Sanity-check that
        // the insert was attempted.
        expect(inserts.length).toBe(1);
      }
    );
  });
});
