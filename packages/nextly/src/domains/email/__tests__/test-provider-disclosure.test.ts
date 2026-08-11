/**
 * What `testProvider` is allowed to tell its caller.
 *
 * The probe and the adapter factory both receive DECRYPTED configuration, and
 * whatever they say about a failure is copied into a response the admin renders
 * in a toast. Masking stored credentials means nothing if pressing Test hands
 * one back, so a provider's own words about a failure stay in the log.
 *
 * A separate file from the CRUD suite because it needs a registered provider,
 * and registry state is global.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { defineEmailProvider } from "../provider-definition";
import { getEmailProviderRegistry } from "../services/email-provider-registry";
import { EmailProviderService } from "../services/email-provider-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const SECRET = "sk_live_the_actual_credential";

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

/** A provider whose probe puts the credential into its own failure detail. */
const chattyProvider = defineEmailProvider<{ apiKey: string }>({
  type: "chatty-probe",
  label: "Chatty Probe",
  capabilities: { connectionTest: true },
  configFields: [
    { name: "apiKey", label: "API Key", kind: "password", secret: true },
  ],
  parseConfig: input => input as { apiKey: string },
  createAdapter: () => ({
    send: () => Promise.resolve({ success: true, messageId: "x" }),
  }),
  testConnection: config =>
    Promise.resolve({ ok: false, detail: `Invalid key ${config.apiKey}` }),
});

describe("testProvider disclosure", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );

    getEmailProviderRegistry().register(chattyProvider);

    const created = await service.createProvider({
      name: "Chatty",
      type: "chatty-probe",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: SECRET },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
    getEmailProviderRegistry().reset();
  });

  it("does not return the probe's own detail to the caller", async () => {
    const result = await service.testProvider(
      providerId,
      undefined,
      "connection"
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // The whole point: a returned failure is as capable of carrying a
    // credential as a thrown one, and normalising only the thrown path leaves
    // the easier route open.
    expect(result.error).not.toContain(SECRET);
  });

  it("keeps the detail for the operator, in the log", async () => {
    await service.testProvider(providerId, undefined, "connection");

    // The control that stops the fix from being "delete the diagnostic".
    const logged = vi
      .mocked(logger.warn)
      .mock.calls.map(call => JSON.stringify(call))
      .join("\n");
    expect(logged).toContain(SECRET);
  });

  it("refuses an unrecognised mode instead of sending a real message", async () => {
    // `mode` decides whether mail leaves the building, and a TypeScript union
    // does not constrain a JavaScript caller or a wrapper forwarding a request
    // body. A misspelling must not fall through to the send path.
    await expect(
      service.testProvider(
        providerId,
        undefined,
        "connecton" as unknown as "connection"
      )
    ).rejects.toThrow(/Unknown email provider test mode/);
  });
});

describe("an adapter that rejects while sending", () => {
  /**
   * The longest-lived route from a credential to a message: the adapter closes
   * over decrypted configuration, so building it succeeds and the disclosure
   * happens later, on a rejection. Wrapping only the factory left this open.
   */
  const leakyOnSend = defineEmailProvider<{ apiKey: string }>({
    type: "leaky-send",
    label: "Leaky Send",
    configFields: [
      { name: "apiKey", label: "API Key", kind: "password", secret: true },
    ],
    parseConfig: input => input as { apiKey: string },
    createAdapter: config => ({
      send: () => Promise.reject(new Error(`Invalid key ${config.apiKey}`)),
    }),
  });

  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(leakyOnSend);

    const created = await service.createProvider({
      name: "Leaky",
      type: "leaky-send",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: SECRET },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
    getEmailProviderRegistry().reset();
  });

  it("does not return the adapter's own message", async () => {
    const result = await service.testProvider(
      providerId,
      "someone@example.com"
    );

    expect(result.success).toBe(false);
    expect(result.error).not.toContain(SECRET);
  });

  it("writes the reason to the log it points at", async () => {
    await service.testProvider(providerId, "someone@example.com");

    // The message tells the operator to read the server log, so something has
    // to have written one. A `cause` attached to an error is not a log entry.
    const logged = vi
      .mocked(logger.error)
      .mock.calls.map(call => JSON.stringify(call))
      .join("\n");
    expect(logged).toContain(SECRET);
  });
});

describe("a test that never reached the provider", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(chattyProvider);
    const created = await service.createProvider({
      name: "Chatty",
      type: "chatty-probe",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: SECRET },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
    getEmailProviderRegistry().reset();
  });

  it("records no delivery when the adapter cannot be built", async () => {
    // The catch around a test send also covers BUILDING the adapter, which
    // throws on its own when a plugin has been removed or stored configuration
    // no longer constructs one. A row for either is a phantom send: history
    // for a message that was never composed.
    const recorded: unknown[] = [];
    // Both methods: a test send goes through `record`, an ordinary send
    // through `recordAll`, and a double carrying only one would make this pass
    // for want of a method rather than for want of a row.
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: unknown) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: (inputs: unknown[]) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };
    (service as unknown as { createAdapterFromProvider: unknown })[
      "createAdapterFromProvider"
    ] = () => {
      throw new Error("the plugin that provided this type is gone");
    };

    const outcome = await service.testProvider(providerId);

    expect(outcome.success).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  it("does not store a test message id that carries the address", async () => {
    // The test destination is a recipient like any other, and a provider may
    // build its identifier out of the address it was handed. Storing it
    // verbatim would put the address beside the hash that exists to avoid
    // holding it.
    const recorded: Array<{ messageId: string | null }> = [];
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: { messageId: string | null }) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: () => Promise.resolve(),
    };
    (service as unknown as { createAdapterFromProvider: unknown })[
      "createAdapterFromProvider"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "delivery-someone@example.com-1",
        }),
    });

    await service.testProvider(providerId, "someone@example.com");

    expect(recorded[0]?.messageId).toBeNull();
  });

  it("keeps an ordinary test message id", async () => {
    // The control: containment is a comparison against the destination, not a
    // blanket refusal to record ids.
    const recorded: Array<{ messageId: string | null }> = [];
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: { messageId: string | null }) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: () => Promise.resolve(),
    };
    (service as unknown as { createAdapterFromProvider: unknown })[
      "createAdapterFromProvider"
    ] = () => ({
      send: () =>
        Promise.resolve({ success: true, messageId: "<abc@mail.example.com>" }),
    });

    await service.testProvider(providerId, "someone@example.com");

    expect(recorded[0]?.messageId).toBe("<abc@mail.example.com>");
  });

  it("records one when the send itself fails", async () => {
    // The control: a recorder that never writes anything would satisfy the
    // case above, so this pins that a send reaching the provider DOES produce
    // a row.
    const recorded: unknown[] = [];
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: unknown) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: (inputs: unknown[]) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };
    (service as unknown as { createAdapterFromProvider: unknown })[
      "createAdapterFromProvider"
    ] = () => ({
      send: () => Promise.reject(new Error("the relay refused the connection")),
    });

    const outcome = await service.testProvider(providerId);

    expect(outcome.success).toBe(false);
    expect(recorded).toHaveLength(1);
  });
});
