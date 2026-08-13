/**
 * A lookup and an erasure must agree about which rows are a person's.
 *
 * Both answer the same question — "which rows belong to this address" — and
 * for a while they answered it differently: the erasure matched every
 * generation of `NEXTLY_SECRET`, the listing matched only the current one. So
 * after a rotation an operator answering "what do you hold about me" would
 * under-report, while a deletion still removed the rows the report omitted.
 *
 * Under-reporting is the dangerous direction, because it is indistinguishable
 * from having nothing: an empty listing is exactly what a person with no mail
 * looks like. Nobody investigates a correct-looking answer.
 *
 * The rotation is performed by MUTATING the environment between the write and
 * the read, which is what an operator actually does — the row is written under
 * one key, and afterwards a different key is current.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { EmailDeliveryService } from "../services/email-delivery-service";

const RECIPIENT = "person@example.com";

// Hoisted with the mock that reads it. `vi.mock` is lifted above every
// statement in the file, and this suite imports the service STATICALLY — so a
// plain `const` would still be uninitialised when the factory first runs.
const { envMock, FIRST, SECOND } = vi.hoisted(() => {
  const first = "first-secret-long-enough-for-hmac-derivation";
  return {
    FIRST: first,
    SECOND: "second-secret-long-enough-for-hmac-derivation",
    envMock: {
      NEXTLY_SECRET: first as string | undefined,
      NEXTLY_SECRET_PREVIOUS: undefined as string | undefined,
      DB_DIALECT: "sqlite",
      DATABASE_URL: undefined,
      NODE_ENV: "test",
    },
  };
});

vi.mock("../../../lib/env", () => ({ env: envMock }));

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

describe("looking a recipient up after a rotation", () => {
  let sqlite: Database.Database;
  let service: EmailDeliveryService;

  beforeEach(() => {
    envMock.NEXTLY_SECRET = FIRST;
    envMock.NEXTLY_SECRET_PREVIOUS = undefined;
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

  it("finds mail recorded before the secret was rotated", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "sent",
    });

    // The rotation. The row on disk still carries the digest FIRST produced,
    // and nothing the current key computes equals it.
    envMock.NEXTLY_SECRET = SECOND;
    envMock.NEXTLY_SECRET_PREVIOUS = FIRST;

    expect(await service.list({ recipient: RECIPIENT })).toHaveLength(1);
  });

  it("still finds mail recorded after it, in the same query", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "sent",
    });

    envMock.NEXTLY_SECRET = SECOND;
    envMock.NEXTLY_SECRET_PREVIOUS = FIRST;

    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "sent",
    });

    // Both generations at once, which is the state every install is in for as
    // long as it keeps the old key. A predicate that swapped to the retired
    // digest instead of adding it would pass the previous case and fail here.
    expect(await service.list({ recipient: RECIPIENT })).toHaveLength(2);
  });

  it("does not widen into other people's mail", async () => {
    // The control against "match more" becoming the fix. Extra digests must
    // reach the same PERSON under older keys, never a different person under
    // any key.
    await service.record({
      to: "someone.else@example.com",
      providerType: "smtp",
      status: "sent",
    });

    envMock.NEXTLY_SECRET = SECOND;
    envMock.NEXTLY_SECRET_PREVIOUS = FIRST;

    expect(await service.list({ recipient: RECIPIENT })).toHaveLength(0);
  });

  it("matches however the caller wrote the address", async () => {
    await service.record({
      to: RECIPIENT,
      providerType: "smtp",
      status: "sent",
    });

    envMock.NEXTLY_SECRET = SECOND;
    envMock.NEXTLY_SECRET_PREVIOUS = FIRST;

    // A display name and casing are how the same person is written in
    // practice, and the normalisation has to hold under every generation
    // rather than only the current one.
    expect(
      await service.list({ recipient: `"A Person" <Person@Example.COM>` })
    ).toHaveLength(1);
  });
});
