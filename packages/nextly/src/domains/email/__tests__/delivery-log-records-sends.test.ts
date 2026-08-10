/**
 * That a send reaches the log, and that no address does.
 *
 * The recorder is only worth having if the send path actually calls it — and
 * only safe if the hashing decision survives the whole round trip rather than
 * holding at the boundary where it was written.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { hashRecipient } from "../delivery-record";
import { EmailDeliveryService } from "../services/email-delivery-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const RECIPIENT = "someone@example.com";

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

describe("the delivery log", () => {
  let sqlite: Database.Database;
  let service: EmailDeliveryService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    createDeliveriesTable(sqlite);
    service = new EmailDeliveryService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  it("records a successful send", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      templateSlug: "password-reset",
      status: "sent",
      messageId: "<abc@example.com>",
    });

    const [row] = await service.list();
    expect(row).toMatchObject({
      providerType: "smtp",
      templateSlug: "password-reset",
      status: "sent",
      attemptCount: 1,
    });
  });

  it("stores no part of the recipient's address", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "failed",
      error: `550 5.1.1 <${RECIPIENT}> User unknown`,
    });

    // Read the RAW table rather than the mapped record: a value that never
    // reaches `list()` can still be sitting in a column, and the column is
    // what an operator with database access sees.
    const raw = JSON.stringify(
      sqlite.prepare("select * from email_deliveries").all()
    );
    expect(raw).not.toContain("someone@example.com");
    expect(raw).not.toContain("someone");
    // The status code and reason survive, which is the control that stops
    // redaction from becoming "store nothing useful".
    expect(raw).toContain("550 5.1.1");
    expect(raw).toContain("User unknown");
  });

  it("finds a delivery by the address it was sent to", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "sent",
    });
    await service.record({
      to: "someone-else@example.com",
      providerType: "smtp",
      status: "sent",
    });

    // Support hashes the address they were given. That is the one question
    // this table is designed to answer about a person.
    const found = await service.list({ recipient: "SOMEONE@example.com  " });
    expect(found).toHaveLength(1);
    expect(found[0]?.recipientHash).toBe(hashRecipient(RECIPIENT));
  });

  it("leaves next_attempt_at NULL, because nothing drains this table", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "failed",
    });

    // A timestamp here would tell an operator to expect a retry that no code
    // will perform. The column is reserved so that adding a drain later is not
    // a migration on a table holding production history — reserved, not live.
    const rows = sqlite
      .prepare("select next_attempt_at from email_deliveries")
      .all() as Array<{ next_attempt_at: unknown }>;
    expect(rows[0]?.next_attempt_at).toBeNull();
  });

  it("does not throw when the table is missing", async () => {
    // An install that predates the table must still be able to send. The log
    // observes delivery; it must never become a thing that prevents it.
    sqlite.exec("drop table email_deliveries");

    await expect(
      service.record({ to: RECIPIENT, providerType: "smtp", status: "sent" })
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to record an email delivery",
      expect.objectContaining({ providerType: "smtp" })
    );
  });
});
