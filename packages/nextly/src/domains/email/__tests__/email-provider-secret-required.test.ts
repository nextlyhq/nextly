/**
 * Tests for EmailProviderService when `NEXTLY_SECRET` is absent.
 *
 * Lives in its own file because the env mock is hoisted per-file: the sibling
 * suite pins a secret for every test it runs, and the behaviour under test here
 * is what happens when there is none.
 *
 * A provider's `configuration` holds SMTP passwords and API keys. Without a
 * secret to encrypt them under, the only two options are to refuse the write or
 * to store the credential readable. The webhook domain already chose refusal for
 * the same threat (`domains/webhooks/secret.ts`), and these tests pin email to
 * the same posture.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { NextlyError } from "../../../errors";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { EmailProviderService } from "../services/email-provider-service";

// The whole point of this file: no secret is configured.
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: undefined,
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

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

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * Render `email_providers` from the same core schema the product ships, rather
 * than hand-copying a CREATE TABLE. A security regression suite is exactly the
 * one that must not certify a shape production no longer has: a fixture written
 * by hand keeps passing after the real column list moves, and reports safety it
 * never re-checked.
 */
function createEmailProvidersTable(sqlite: Database.Database): void {
  const { tables } = getCoreSchema("sqlite");
  const spec = tables.find(t => t.name === "email_providers");
  if (!spec) {
    // A vitest failure rather than a thrown error: the table vanishing from
    // the core schema is a broken precondition of this fixture, not a runtime
    // fault, and reporting it as the test failure it is names the file that
    // needs updating. `expect.fail` returns `never`, so `spec` narrows below.
    expect.fail(
      "email_providers is absent from the core schema — this fixture can no longer be derived from it."
    );
  }
  const body = createTableBody(spec, (id: string) => `"${id}"`);
  sqlite.exec(`CREATE TABLE "email_providers" (\n${body}\n)`);
}

function createInMemoryDb() {
  const sqlite = new Database(":memory:");
  createEmailProvidersTable(sqlite);
  // No `schema`/`relations` option: these tests only use `db.select()`, never
  // the relational query API that a schema map exists to type.
  const db = drizzle({ client: sqlite });
  return { sqlite, db };
}

const INPUT = {
  name: "SMTP",
  type: "smtp" as const,
  fromEmail: "noreply@example.com",
  fromName: "App",
  configuration: {
    host: "smtp.example.com",
    port: 587,
    auth: { user: "u", pass: "super-secret-password" },
  },
  isDefault: false,
  isActive: true,
};

describe("EmailProviderService without NEXTLY_SECRET", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;
  let service: EmailProviderService;

  beforeEach(() => {
    const made = createInMemoryDb();
    sqlite = made.sqlite;
    db = made.db;
    service = new EmailProviderService(makeAdapter(db), logger);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("refuses to create a provider rather than storing the credential readable", async () => {
    await expect(service.createProvider(INPUT)).rejects.toBeInstanceOf(
      NextlyError
    );
  });

  it("names the missing variable so the remedy does not require reading source", async () => {
    // The operator hitting this is one environment variable away from working.
    // A generic "unexpected error" would send them to the server logs for a
    // fact the message can carry safely: `NEXTLY_SECRET` is a variable name,
    // not a secret.
    const error = await service.createProvider(INPUT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NextlyError);
    expect((error as NextlyError).publicMessage).toContain("NEXTLY_SECRET");
  });

  it("writes no row when it refuses", async () => {
    // A refusal that still inserted would be worse than the bug it replaces:
    // a provider row that cannot be decrypted and that nothing will retry.
    await service.createProvider(INPUT).catch(() => undefined);

    const rows = await db.select().from(emailProvidersSqlite);
    expect(rows).toHaveLength(0);
  });

  it("stores the credential nowhere the database can reveal it", async () => {
    // The positive control for this whole file. Before the fix this test fails
    // by FINDING the password, which is the exact defect; asserting only that
    // an error was thrown would pass against a service that threw for some
    // unrelated reason while still writing the row.
    await service.createProvider(INPUT).catch(() => undefined);

    const dump = JSON.stringify(
      sqlite.prepare("SELECT * FROM email_providers").all()
    );
    expect(dump).not.toContain("super-secret-password");
  });

  it("refuses to update a provider's configuration for the same reason", async () => {
    // Update re-encrypts a merged config, so it is a second write path to the
    // same column and needs its own guard, not merely the one on create.
    await db.insert(emailProvidersSqlite).values({
      id: "p1",
      name: "SMTP",
      type: "smtp",
      fromEmail: "noreply@example.com",
      configuration: {},
      isDefault: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.updateProvider("p1", {
        configuration: { auth: { user: "u", pass: "another-secret" } },
      })
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("still reads a provider that was stored before the guard existed", async () => {
    // Installs that already wrote plaintext must stay readable. Refusing to
    // decrypt them would convert an old security bug into new data loss, and
    // would hide the very rows an operator needs to find and rotate.
    await db.insert(emailProvidersSqlite).values({
      id: "legacy",
      name: "Legacy",
      type: "resend",
      fromEmail: "old@example.com",
      // The shape an install that wrote before the guard would hold: the
      // configuration object itself, not a ciphertext string.
      configuration: { apiKey: "re_stored_in_the_clear" },
      isDefault: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const provider = await service.getProvider("legacy");
    expect(provider.id).toBe("legacy");
    // Masked on the public read path, as any provider is.
    expect(JSON.stringify(provider.configuration)).not.toContain(
      "re_stored_in_the_clear"
    );
  });
});
