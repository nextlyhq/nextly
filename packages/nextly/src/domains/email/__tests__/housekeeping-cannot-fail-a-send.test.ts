/**
 * Housekeeping cannot fail a send, including when the reporting fails.
 *
 * Every layer between a prune query and the send that offered it catches, and
 * then LOGS. The logger is supplied by the installing app, so it is arbitrary
 * code — and it runs INSIDE the catch that is meant to contain everything.
 * When it throws there, the throw leaves from the one position nothing is
 * guarding and travels up through every careful `try` beneath it.
 *
 * What it reaches is `recordAll`, whose contract is that a recorded send is
 * never reported as a failed one. The rows are already written and the
 * provider has already accepted the message by that point, so a rejection
 * invites the caller to send it a second time. That is the failure mode these
 * cases exist for: not "the prune broke" but "the prune's apology broke, and
 * the user got two password-reset emails".
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { warnQuietly } from "../../retention/safe-log";
import { pruneEmailDataSafely, type EmailPruneAdapter } from "../prune";
import { resolveEmailRetentionConfig } from "../retention-config";
import { EmailDeliveryService } from "../services/email-delivery-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

/** A logger that fails the way an app-supplied one can: from inside a catch. */
function hostileLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(() => {
      throw new Error("the logging transport is down");
    }),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

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

describe("a send survives its own housekeeping", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    createDeliveriesTable(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  function serviceWith(
    logger: Logger,
    retention?: { maybeRun(maxBatches?: number): Promise<void> }
  ): EmailDeliveryService {
    return new EmailDeliveryService(
      makeAdapter(drizzle({ client: sqlite })),
      logger,
      retention
    );
  }

  it("records the rows even when the retention offer rejects", async () => {
    const logger = hostileLogger();
    const service = serviceWith(logger, {
      maybeRun: async () => {
        throw new Error("retention runner exploded");
      },
    });

    await expect(
      service.recordAll([
        { to: "a@example.com", providerType: "smtp", status: "sent" },
        { to: "b@example.com", providerType: "smtp", status: "sent" },
      ])
    ).resolves.toBeUndefined();

    // The positive control, and the reason this is not just "it did not
    // throw": a `recordAll` that returned early before inserting would also
    // not throw, and would pass an assertion about the rejection alone.
    expect(await service.list()).toHaveLength(2);
  });

  it("survives a logger that throws from inside the containment", async () => {
    // The double-throw. The runner catches its own failure and reports it; the
    // report throws; the second throw has no catch left above it. A permissive
    // logger double would certify this path while a real one broke it, so the
    // logger here is deliberately hostile rather than a spy.
    const logger = hostileLogger();
    const service = serviceWith(logger, {
      maybeRun: async () => {
        throw new Error("retention runner exploded");
      },
    });

    await expect(
      service.recordAll([
        { to: "a@example.com", providerType: "smtp", status: "sent" },
      ])
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
  });

  it("keeps a failing prune and a failing logger away from the caller", async () => {
    const logger = hostileLogger();
    const adapter: EmailPruneAdapter = {
      select: async () => {
        throw new Error("connection lost");
      },
      delete: async () => 0,
    };

    // Both halves fail at once: the query this exists to absorb, and the
    // apology for it. Neither may reach the caller.
    await expect(
      pruneEmailDataSafely({ adapter, logger }, resolveEmailRetentionConfig())
    ).resolves.toEqual({ deliveries: 0 });
  });
});

describe("reporting a swallowed failure", () => {
  it("cannot itself become the failure", () => {
    // There is no fallback reporter, because the only one available is the one
    // that just failed. Losing the message costs visibility into an already
    // degraded pass; letting it escape costs the caller's contract.
    expect(() => warnQuietly(hostileLogger(), "anything")).not.toThrow();
  });

  it("does nothing at all when no logger was supplied", () => {
    expect(() => warnQuietly(undefined, "anything")).not.toThrow();
  });

  it("still delivers the message and its context to a working logger", () => {
    // The control that stops this from degrading into "never logs". A helper
    // that swallowed everything would pass both cases above.
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    warnQuietly(logger, "a message", { detail: 1 });

    expect(logger.warn).toHaveBeenCalledWith("a message", { detail: 1 });
  });
});
