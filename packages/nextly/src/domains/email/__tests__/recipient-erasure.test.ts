/**
 * That erasing a recipient removes the person and keeps the record.
 *
 * The delivery log answers two questions with one row: "how many sends failed"
 * belongs to the install, and "was this person written to" belongs to the
 * person. These assert that the erasure separates them — the row, its status
 * and its timing survive, and the only column that could still name a human
 * stops being able to.
 *
 * Every assertion here is a form of "the address no longer matches", which is
 * also what an erasure that silently did nothing to a table nobody wrote to
 * would produce. So each one is paired with a control that fails when the
 * erasure is removed: a second recipient that must SURVIVE, and a lookup that
 * must find the row before the erasure runs.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { deliveriesTableFor } from "../deliveries-table";
import { ERASED_RECIPIENT_HASH, recipientDigest } from "../delivery-record";
import { eraseRecipientDeliveries } from "../erase-recipient";
import { EmailDeliveryService } from "../services/email-delivery-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const ERASED = "erase-me@example.com";
const KEPT = "someone-else@example.com";

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeAdapter(db: ReturnType<typeof drizzle>): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as DrizzleAdapter;
}

/** Rendered from the shipped core schema, never hand-copied DDL. */
function createDeliveriesTable(sqlite: Database.Database): void {
  const { tables } = getCoreSchema("sqlite");
  const spec = tables.find(table => table.name === "email_deliveries");
  if (!spec) {
    expect.fail(
      "email_deliveries is absent from the core schema — the table is not registered, which no unit test would otherwise catch."
    );
  }
  sqlite.exec(
    `CREATE TABLE "email_deliveries" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
  );
}

describe("erasing a recipient from the delivery log", () => {
  let sqlite: Database.Database;
  let service: EmailDeliveryService;
  let db: ReturnType<typeof drizzle>;

  async function erase(address: string): Promise<void> {
    await eraseRecipientDeliveries(db, deliveriesTableFor("sqlite"), address);
  }

  /** Straight to the column, so the assertions can see what the reader hides. */
  function storedHashes(): string[] {
    return sqlite
      .prepare(`SELECT "recipient_hash" AS h FROM "email_deliveries"`)
      .all()
      .map(row => (row as { h: string }).h);
  }

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createDeliveriesTable(sqlite);
    db = drizzle({ client: sqlite });
    service = new EmailDeliveryService(makeAdapter(db), logger);

    for (const to of [ERASED, KEPT]) {
      await service.record({
        to,
        providerType: "smtp",
        templateSlug: "password-reset",
        status: "failed",
        error: "mailbox unavailable",
      });
    }
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  it("finds the row before erasure, so a later miss means erased and not absent", async () => {
    // The control the rest of the file depends on. Without it, an erasure that
    // did nothing and a fixture that never wrote the row are the same result.
    expect(await service.list({ recipient: ERASED })).toHaveLength(1);
    expect(await service.list({ recipient: KEPT })).toHaveLength(1);
  });

  it("makes the erased address unmatchable", async () => {
    await erase(ERASED);

    expect(await service.list({ recipient: ERASED })).toEqual([]);
  });

  it("leaves every other recipient matchable", async () => {
    // The scope control. An erasure that emptied the column for every row would
    // pass the assertion above and fail this one.
    await erase(ERASED);

    expect(await service.list({ recipient: KEPT })).toHaveLength(1);
    expect(storedHashes()).toContain(recipientDigest(KEPT));
  });

  it("keeps the row, its status and its error", async () => {
    await erase(ERASED);

    const rows = await service.list();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status === "failed")).toBe(true);
    expect(rows.every(row => row.error === "mailbox unavailable")).toBe(true);
  });

  it("reports an erased recipient as null rather than as the sentinel", async () => {
    await erase(ERASED);

    const erasedRecord = (await service.list()).find(
      row => row.recipientHash === null
    );
    expect(erasedRecord).toBeDefined();
    // The reader must not leak the storage spelling, and the column must still
    // hold it — a null in the DATABASE would mean the NOT NULL constraint had
    // been relaxed, which is the migration this design exists to avoid.
    expect(storedHashes()).toContain(ERASED_RECIPIENT_HASH);
  });

  it("matches however the address was written", async () => {
    // The erasure and the lookup share one digest function. If they ever stop
    // sharing it, a display-name form erases nothing while a lookup on the bare
    // mailbox still finds the row.
    await erase(`Someone <${ERASED}>`);

    expect(await service.list({ recipient: ERASED })).toEqual([]);
  });

  it("changes nothing when run a second time", async () => {
    await erase(ERASED);
    const afterFirst = storedHashes().slice().sort();
    // Pins that the first erasure DID something. Comparing two snapshots is
    // satisfied by an erasure that never runs — both would be the untouched
    // column — so without this the idempotency claim is true of a no-op.
    expect(afterFirst).toContain(ERASED_RECIPIENT_HASH);

    await erase(ERASED);

    expect(storedHashes().slice().sort()).toEqual(afterFirst);
  });

  it("does not suppress a later send to the same address", async () => {
    // Erasure is a statement about the record as it stands, not a standing
    // instruction to stop recording. Suppressing future rows would require
    // keeping a list of the addresses that asked to be forgotten, which stores
    // exactly what the request asked to remove. Asserted so it is not later
    // "fixed" into that.
    await erase(ERASED);

    await service.record({
      to: ERASED,
      providerType: "smtp",
      status: "sent",
    });

    expect(await service.list({ recipient: ERASED })).toHaveLength(1);
    expect(storedHashes()).toContain(recipientDigest(ERASED));
  });
});
