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

import { NextlyError } from "../../../errors";
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

  it("records one row per recipient, saying how each received it", async () => {
    // The table answers questions about a PERSON, and someone copied on a
    // message received it exactly as the primary recipient did. Recording only
    // `to` would answer "no record" for someone holding the message.
    await service.recordAll([
      { to: RECIPIENT, providerType: "smtp", status: "sent" },
      {
        to: "cc@example.com",
        recipientKind: "cc",
        providerType: "smtp",
        status: "sent",
      },
      {
        to: "bcc@example.com",
        recipientKind: "bcc",
        providerType: "smtp",
        status: "sent",
      },
    ]);

    const rows = await service.list();
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.recipientKind).sort()).toEqual([
      "bcc",
      "cc",
      "to",
    ]);

    // The query the whole column exists for: a copied recipient is findable
    // by the address they were copied at.
    const copied = await service.list({ recipient: "CC@example.com" });
    expect(copied).toHaveLength(1);
    expect(copied[0]?.recipientKind).toBe("cc");
    // The control: the primary recipient is still findable, so this is not a
    // test that passes because everything became a `cc`.
    const primary = await service.list({ recipient: RECIPIENT });
    expect(primary).toHaveLength(1);
    expect(primary[0]?.recipientKind).toBe("to");
  });

  it("reports a failed listing as a NextlyError, not a driver error", async () => {
    // Reading and recording are deliberately asymmetric. `record` swallows,
    // because a log that cannot be written must not fail a send. `list` is a
    // read someone asked for, so its failure has to arrive as the typed error
    // the API layer knows how to render — with a generic public message rather
    // than the driver's own text.
    sqlite.exec("drop table email_deliveries");

    const error = await service.list().then(
      () => undefined,
      (thrown: unknown) => thrown
    );

    expect(error).toBeInstanceOf(NextlyError);
    const nextly = error as NextlyError;
    // A missing table is not a connection or constraint failure, so it
    // classifies as internal — the point is that it classifies at all, and
    // carries a status the API layer can answer with.
    expect(nextly.code).toBe("INTERNAL_ERROR");
    expect(nextly.statusCode).toBe(500);
    // The control: the driver's message names the missing table, and the
    // public message must not carry it. Without this the assertions above
    // would pass on an error that still leaked schema details.
    expect(nextly.message).not.toContain("email_deliveries");
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

describe("a provider deleted while its send is in flight", () => {
  let sqlite: Database.Database;

  /**
   * A database whose first insert rejects the way a foreign key does.
   *
   * The real constraint lives in the dialect schemas, and `createTableBody`
   * renders columns only — no REFERENCES clause — so a fixture built from it
   * accepts a dangling id and never reaches this path at all. Driving the
   * rejection directly is what actually exercises the recovery.
   */
  function dbThatRejectsTheFirstInsert(
    db: ReturnType<typeof drizzle>
  ): ReturnType<typeof drizzle> {
    let failed = false;
    return new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "insert") {
          return Reflect.get(target, property, receiver) as unknown;
        }
        return (table: unknown) => {
          if (failed) return target.insert(table as never);
          failed = true;
          return {
            values: () =>
              // The shape better-sqlite3 actually produces, so `toDbError`
              // classifies it as `fk-violation` — the only kind this retry is
              // allowed to act on.
              Promise.reject(
                Object.assign(
                  new Error(
                    "FOREIGN KEY constraint failed: email_deliveries.provider_id"
                  ),
                  { code: "SQLITE_CONSTRAINT_FOREIGNKEY" }
                )
              ),
          };
        };
      },
    }) as ReturnType<typeof drizzle>;
  }

  beforeEach(() => {
    sqlite = new Database(":memory:");
    createDeliveriesTable(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  it("still records the send, without the reference", async () => {
    // The message was accepted by the provider. Losing its row because someone
    // edited settings mid-send would make the log's completeness depend on
    // nobody touching the admin.
    const db = drizzle({ client: sqlite });
    const service = new EmailDeliveryService(
      makeAdapter(dbThatRejectsTheFirstInsert(db)),
      logger
    );

    await service.record({
      to: RECIPIENT,
      providerId: "11111111-1111-1111-1111-111111111111",
      providerType: "smtp",
      status: "sent",
    });

    const rows = await new EmailDeliveryService(makeAdapter(db), logger).list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerType: "smtp", status: "sent" });
    // Null rather than the dangling id: the row is honest about not resolving.
    expect(rows[0]?.providerId).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "Recorded an email delivery without its provider reference",
      expect.objectContaining({ providerType: "smtp" })
    );
  });

  it("keeps the reference when the insert succeeds", async () => {
    // The control. Without it the case above would pass on a recorder that had
    // simply stopped storing provider ids at all, which would cost every row
    // its link to the provider that sent it.
    const service = new EmailDeliveryService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );

    await service.record({
      to: RECIPIENT,
      providerId: "22222222-2222-2222-2222-222222222222",
      providerType: "smtp",
      status: "sent",
    });

    const [row] = await service.list();
    expect(row?.providerId).toBe("22222222-2222-2222-2222-222222222222");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not clear the reference for a failure that is not the key", async () => {
    // A deadlock, a timeout or a lost connection has nothing to do with the
    // provider reference. Retrying without it would quietly weaken every row
    // written during a database hiccup.
    const db = drizzle({ client: sqlite });
    let failed = false;
    const flaky = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "insert") {
          return Reflect.get(target, property, receiver) as unknown;
        }
        return (table: unknown) => {
          if (failed) return target.insert(table as never);
          failed = true;
          return {
            values: () =>
              Promise.reject(
                Object.assign(new Error("connection lost"), {
                  code: "ECONNRESET",
                })
              ),
          };
        };
      },
    }) as ReturnType<typeof drizzle>;

    const service = new EmailDeliveryService(makeAdapter(flaky), logger);
    await service.record({
      to: RECIPIENT,
      providerId: "33333333-3333-3333-3333-333333333333",
      providerType: "smtp",
      status: "sent",
    });

    // No retry at all: nothing written, and the failure reported as itself.
    const rows = await new EmailDeliveryService(makeAdapter(db), logger).list();
    expect(rows).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to record an email delivery",
      expect.objectContaining({ providerType: "smtp" })
    );
  });

  it("reports the original failure when the retry fails too", async () => {
    // A retry that also fails means the cause was never the key, and the
    // message worth logging is the first one.
    const broken = drizzle({ client: sqlite });
    sqlite.exec("drop table email_deliveries");
    const service = new EmailDeliveryService(makeAdapter(broken), logger);

    await expect(
      service.record({ to: RECIPIENT, providerType: "smtp", status: "sent" })
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to record an email delivery",
      expect.objectContaining({ providerType: "smtp" })
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
