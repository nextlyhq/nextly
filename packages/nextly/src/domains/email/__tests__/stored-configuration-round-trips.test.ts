/**
 * What is stored must survive being read back and parsed again.
 *
 * The service persists the value `parseConfig` returned, and an adapter is
 * built by re-parsing what the column holds. So the write is only safe when
 * parsing the stored form returns the stored form — otherwise the operator
 * saves one configuration and the adapter runs on another, with nothing in
 * between reporting a difference.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import type { Logger } from "../../../services/shared";
import { defineEmailProvider } from "../provider-definition";
import {
  getEmailProviderRegistry,
  resetEmailProviderRegistry,
} from "../services/email-provider-registry";
import { EmailProviderService } from "../services/email-provider-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
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

function createInMemoryDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS email_providers (
      id            TEXT    PRIMARY KEY,
      name          TEXT    NOT NULL,
      type          TEXT    NOT NULL,
      from_email    TEXT    NOT NULL,
      from_name     TEXT,
      configuration TEXT    NOT NULL,
      is_default    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `);
  return {
    sqlite,
    db: drizzle({ client: sqlite, schema: { emailProvidersSqlite } }),
  };
}

/** A provider whose parser is whatever the case under test needs it to be. */
function register(type: string, parseConfig: (input: unknown) => object) {
  getEmailProviderRegistry().register(
    defineEmailProvider<object>({
      type,
      label: type,
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig,
      createAdapter: () => ({
        send: () => Promise.resolve({ success: true }),
      }),
    })
  );
}

describe("a configuration whose parse is not a fixed point", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;

  const write = (type: string, configuration: Record<string, unknown>) =>
    service.createProvider({
      name: "Test",
      type: type as never,
      fromEmail: "from@example.com",
      configuration,
    });

  beforeEach(() => {
    resetEmailProviderRegistry();
    const { sqlite: s, db } = createInMemoryDb();
    sqlite = s;
    service = new EmailProviderService(makeAdapter(db), logger);
  });

  afterEach(() => {
    sqlite.close();
    resetEmailProviderRegistry();
  });

  // The POSITIVE CONTROL. A parser that reshapes rather than derives is the
  // ordinary case, and it has to keep working — a check that refused every
  // write would pass the three below while telling nobody anything.
  it("stores a configuration a reshaping parser accepts back", async () => {
    register("reshaping", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey).trim(),
    }));

    const provider = await write("reshaping", { apiKey: "  k  " });

    expect(provider.id).toBeTruthy();
  });

  // Encoding on the way in and encoding the encoding on the way out. The
  // operator entered a correct key and the provider would answer "bad key".
  it("refuses a parser that derives its value", async () => {
    register("deriving", input => ({
      apiKey: Buffer.from(
        String((input as { apiKey: unknown }).apiKey)
      ).toString("base64"),
    }));

    await expect(write("deriving", { apiKey: "secret" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // JSON carries no `Date`, so the column holds a string and the adapter is
  // handed a shape this provider's own parser just rejected.
  it("refuses a parser returning a value JSON cannot carry", async () => {
    register("dated", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      issuedAt: new Date(0),
    }));

    await expect(write("dated", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // The same property reached by throwing rather than by returning something
  // different, which is what a parser that rejects its own output does.
  it("refuses a parser that rejects its own output", async () => {
    register("self-rejecting", input => {
      const value = input as { apiKey: unknown; parsed?: boolean };
      if (value.parsed === true) throw new Error("already parsed");
      return { apiKey: String(value.apiKey), parsed: true };
    });

    await expect(write("self-rejecting", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // `undefined` is a third value JSON cannot carry, not an exception to the
  // rule: the column drops the key and the parser puts it back, so what is
  // held and what is stored are different objects on every read.
  it("refuses a parser that returns an undefined-valued key", async () => {
    register("optional", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      label: undefined,
    }));

    await expect(write("optional", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // A parser that OMITS the key instead round-trips cleanly, which is the
  // shape an optional field normally takes and has to keep working.
  it("stores a configuration whose parser omits an absent optional", async () => {
    register("omitting", input => {
      const value = input as { apiKey: unknown; label?: unknown };
      return typeof value.label === "string"
        ? { apiKey: String(value.apiKey), label: value.label }
        : { apiKey: String(value.apiKey) };
    });

    const provider = await write("omitting", { apiKey: "k" });

    expect(provider.id).toBeTruthy();
  });
});
