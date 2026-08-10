/**
 * What a provider mutation writes to the activity log, and what it must not.
 *
 * The trail exists because an actor who can edit a provider can point every
 * password-reset and verification email at a relay they control. It is read by
 * more people than the record it describes, so the value of the trail depends
 * entirely on it never carrying what it audits.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { container } from "../../../di/container";
import { getCoreSchema } from "../../../schemas";
import type { LogActivityInput } from "../../../services/dashboard/activity-log-service";
import type { Logger } from "../../../services/shared";
import { SYSTEM_CONTEXT } from "../../../shared/types";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { EMAIL_PROVIDER_ACTIVITY_COLLECTION } from "../provider-activity";
import { EmailProviderService } from "../services/email-provider-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const PASSWORD = "the-smtp-password-nobody-should-see";
const ACTOR = { type: "user" as const, id: "user-1" };

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** Captures what the service hands the activity log. */
const logged: LogActivityInput[] = [];

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
function createEmailProvidersTable(sqlite: Database.Database): void {
  const { tables } = getCoreSchema("sqlite");
  const spec = tables.find(table => table.name === "email_providers");
  if (!spec) {
    expect.fail(
      "email_providers is absent from the core schema — this fixture can no longer be derived from it."
    );
  }
  sqlite.exec(
    `CREATE TABLE "email_providers" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
  );
}

const INPUT = {
  name: "Production SMTP",
  type: "smtp" as const,
  fromEmail: "noreply@example.com",
  fromName: "App",
  configuration: {
    host: "smtp.example.com",
    port: 587,
    secure: true,
    auth: { user: "postmaster", pass: PASSWORD },
  },
  isDefault: false,
  isActive: true,
};

describe("email provider activity", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );

    logged.length = 0;
    // `register` takes a FACTORY, so the fake is returned rather than stored.
    container.register("activityLogService", () => ({
      logActivity: (input: LogActivityInput) => {
        logged.push(input);
        return Promise.resolve();
      },
    }));
  });

  afterEach(() => {
    sqlite.close();
    // No per-key removal on the container; this file registers nothing else.
    container.clear();
    vi.clearAllMocks();
  });

  it("records a create against the acting user", async () => {
    const provider = await service.createProvider(INPUT, ACTOR);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      userId: "user-1",
      action: "create",
      collection: EMAIL_PROVIDER_ACTIVITY_COLLECTION,
      entryId: provider.id,
      entryTitle: "Production SMTP",
      metadata: { providerType: "smtp" },
    });
  });

  it("never writes any part of the configuration", async () => {
    // All four actions, in an order the product allows: a default provider
    // cannot be deleted, so the promoted one is not the one removed.
    const created = await service.createProvider(INPUT, ACTOR);
    await service.updateProvider(
      created.id,
      {
        configuration: {
          ...INPUT.configuration,
          auth: { user: "postmaster", pass: "a-new-password" },
        },
      },
      ACTOR
    );
    await service.deleteProvider(created.id, ACTOR);

    const promoted = await service.createProvider(
      { ...INPUT, name: "Secondary SMTP" },
      ACTOR
    );
    await service.setDefault(promoted.id, ACTOR);

    // The whole point. Asserted over the SERIALISED rows, because a credential
    // nested three levels down inside `metadata` would satisfy any field-by-
    // field check written from the shape this code happens to produce today.
    const serialised = JSON.stringify(logged);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain("a-new-password");
    expect(serialised).not.toContain("postmaster");
    expect(serialised).not.toContain("smtp.example.com");
  });

  it("names which fields an update touched, and only those", async () => {
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.updateProvider(created.id, { name: "Renamed" }, ACTOR);

    expect(logged[0]?.metadata).toEqual({
      providerType: "smtp",
      changedFields: ["name"],
    });
  });

  it("counts a configuration change as one name, not by inner path", async () => {
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.updateProvider(
      created.id,
      {
        configuration: {
          ...INPUT.configuration,
          auth: { user: "postmaster", pass: "rotated" },
        },
      },
      ACTOR
    );

    // `auth.pass` would say WHICH credential changed, which is a detail about
    // the secret in a row the secret is not supposed to reach.
    expect(logged[0]?.metadata).toEqual({
      providerType: "smtp",
      changedFields: ["configuration"],
    });
  });

  it("does not report a credential change when the credential did not change", async () => {
    // The form always sends `configuration`, even when only the name was
    // edited. Encryption is randomised — a fresh salt and IV per call — so
    // comparing the new ciphertext with the stored one made every save look
    // like a credential change. A false alarm on the one signal the trail
    // exists for is worse than no entry.
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.updateProvider(
      created.id,
      { name: "Renamed", configuration: INPUT.configuration },
      ACTOR
    );

    expect(logged[0]?.metadata).toEqual({
      providerType: "smtp",
      changedFields: ["name"],
    });
  });

  it("does report one when the credential actually changes", async () => {
    // The control: exempting an identical configuration must not exempt a
    // real rotation, which is the event the trail is for.
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.updateProvider(
      created.id,
      {
        configuration: {
          ...INPUT.configuration,
          auth: { user: "postmaster", pass: "rotated" },
        },
      },
      ACTOR
    );

    expect(logged[0]?.metadata).toEqual({
      providerType: "smtp",
      changedFields: ["configuration"],
    });
  });

  it("ignores a request key the service does not recognise", async () => {
    // The update body is a cast over parsed JSON. An unknown key is ignored by
    // every write, so reporting it would claim a change that never happened —
    // and put a request-controlled string into a widely readable row.
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.updateProvider(
      created.id,
      { notAProviderField: true } as unknown as Parameters<
        typeof service.updateProvider
      >[1],
      ACTOR
    );

    expect(logged[0]?.metadata).toEqual({ providerType: "smtp" });
  });

  it("reports nothing changed when an update changes nothing", async () => {
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.updateProvider(created.id, { name: INPUT.name }, ACTOR);

    // The control for the diff: a no-op update must not report a field.
    expect(logged[0]?.metadata).toEqual({ providerType: "smtp" });
  });

  it("records a promotion to default", async () => {
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.setDefault(created.id, ACTOR);

    expect(logged[0]).toMatchObject({
      action: "update",
      entryId: created.id,
      metadata: { providerType: "smtp", changedFields: ["isDefault"] },
    });
  });

  it("records a delete, naming the provider that no longer exists", async () => {
    const created = await service.createProvider(INPUT, ACTOR);
    logged.length = 0;

    await service.deleteProvider(created.id, ACTOR);

    // The feed outlives the row, so the heading has to be carried at write
    // time — after the delete there is nothing left to resolve it from.
    expect(logged[0]).toMatchObject({
      action: "delete",
      entryId: created.id,
      entryTitle: "Production SMTP",
    });
  });

  it("records nothing for a write with no signed-in actor", async () => {
    // A seed, a migration or an API key carries no account. The actor column is
    // a user reference whose erasure state is answered against the accounts
    // table, so an id with no account behind it files as an already-erased
    // identity — a worse record than none.
    await service.createProvider(INPUT);
    await service.createProvider(
      { ...INPUT, name: "By key" },
      {
        type: "apiKey",
        id: "key-1",
      }
    );
    await service.createProvider(
      { ...INPUT, name: "By system" },
      {
        type: "user",
        id: SYSTEM_CONTEXT.user?.id ?? "system",
      }
    );

    expect(logged).toHaveLength(0);
  });

  it("does not fail the mutation when the trail cannot be written", async () => {
    container.register("activityLogService", () => ({
      logActivity: () => Promise.reject(new Error("activity log is down")),
    }));

    // The write has already committed. Turning a completed credential change
    // into a reported failure would leave the caller believing the opposite of
    // the truth.
    await expect(service.createProvider(INPUT, ACTOR)).resolves.toMatchObject({
      name: "Production SMTP",
    });
    // Not silent, though: a trail that stops being written shows up in the log.
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to record email provider activity",
      expect.objectContaining({ action: "create" })
    );
  });
});
