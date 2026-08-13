/**
 * "Keep nothing" has to mean nothing was kept.
 *
 * A retention window of zero is not an aggressive prune schedule. It is an
 * operator saying they do not want a record of who was written to — usually
 * the whole reason they went looking for the setting.
 *
 * Writing the row and deleting it later fails that in two ways, and both are
 * invisible from the configuration. The digest sits in the table until a pass
 * is next due, and the gate holds passes off for a full interval; and the rows
 * written after the final pass stay forever, because the only thing that offers
 * a pass is another send. An install that stops sending keeps its last
 * recipients permanently, under a setting that reads as keeping none.
 *
 * The sweep is still offered, which is the half a "just do not write" fix would
 * get wrong: rows recorded before the setting changed are exactly what the
 * operator expects to disappear.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import {
  resolveEmailRetentionConfig,
  type ResolvedEmailRetentionConfig,
} from "../retention-config";
import { EmailDeliveryService } from "../services/email-delivery-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

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

describe("a zero retention window", () => {
  let sqlite: Database.Database;
  let sweeps: number;
  let sweptWith: Array<number | undefined>;
  let policy: ResolvedEmailRetentionConfig | undefined;

  function service(): EmailDeliveryService {
    return new EmailDeliveryService(
      makeAdapter(drizzle({ client: sqlite })),
      logger,
      {
        maybeRun: async (maxBatches?: number) => {
          sweeps += 1;
          sweptWith.push(maxBatches);
        },
      },
      () => policy
    );
  }

  beforeEach(() => {
    sqlite = new Database(":memory:");
    createDeliveriesTable(sqlite);
    sweeps = 0;
    sweptWith = [];
    policy = undefined;
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  it("writes no row at all", async () => {
    policy = resolveEmailRetentionConfig({ maxAgeMs: 0 });

    await service().record({
      to: "person@example.com",
      providerType: "smtp",
      status: "sent",
    });

    // Read the RAW table, not `list()`. The question is what an operator with
    // database access would find, and a filtered reader could hide a row that
    // is really there.
    expect(sqlite.prepare("select * from email_deliveries").all()).toEqual([]);
  });

  it("still offers the sweep, so rows from before the change go", async () => {
    // The half that a plain "stop writing" would get wrong. Turning retention
    // to zero has to remove what is already there, and the send path is the
    // only thing that offers a pass.
    policy = resolveEmailRetentionConfig({ maxAgeMs: 0 });

    await service().record({
      to: "person@example.com",
      providerType: "smtp",
      status: "sent",
    });

    expect(sweeps).toBe(1);
  });

  it("caps the sweep it offers, because the caller is waiting", async () => {
    // The runner now carries EVERY domain's policy, so an uncapped offer spends
    // each one's full configured budget -- dozens of delete batches by default
    // -- synchronously, after the provider has already accepted the message. A
    // serverless request times out long before that finishes, and a timed-out
    // caller sends the mail again.
    policy = resolveEmailRetentionConfig({ maxAgeMs: 30 * DAY_MS });

    await service().record({
      to: "person@example.com",
      providerType: "smtp",
      status: "sent",
    });

    // A number, and a small one. `undefined` here means "spend the whole
    // budget", which is the defect rather than a neutral default.
    expect(sweptWith).toHaveLength(1);
    expect(sweptWith[0]).toBeGreaterThan(0);
    expect(sweptWith[0]).toBeLessThanOrEqual(4);
  });

  it("records normally under any other window", async () => {
    // The control. A guard that suppressed recording whenever a policy existed
    // would pass both cases above and quietly empty the log for every install
    // that configured retention at all.
    policy = resolveEmailRetentionConfig({ maxAgeMs: 30 * DAY_MS });

    await service().record({
      to: "person@example.com",
      providerType: "smtp",
      status: "sent",
    });

    expect(sqlite.prepare("select * from email_deliveries").all()).toHaveLength(
      1
    );
  });

  it("records normally when retention was never configured", async () => {
    // `undefined` is "no policy carried", which is not the same as zero and
    // must not be read as one — that would make an unconfigured install stop
    // logging deliveries entirely.
    policy = undefined;

    await service().record({
      to: "person@example.com",
      providerType: "smtp",
      status: "sent",
    });

    expect(sqlite.prepare("select * from email_deliveries").all()).toHaveLength(
      1
    );
  });

  it("records normally when the window is false", async () => {
    // `false` is keep FOREVER, the opposite end from zero. Confusing the two
    // falsy values here would delete exactly the log an operator asked to keep.
    policy = resolveEmailRetentionConfig({ maxAgeMs: false });

    await service().record({
      to: "person@example.com",
      providerType: "smtp",
      status: "sent",
    });

    expect(sqlite.prepare("select * from email_deliveries").all()).toHaveLength(
      1
    );
  });
});
