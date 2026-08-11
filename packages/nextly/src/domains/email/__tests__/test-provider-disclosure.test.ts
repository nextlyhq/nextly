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

    // Withholding the detail from the CALLER must not withhold it from the
    // operator: the message tells them to read the server log, so something
    // has to have written one.
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
    // The reason, without the credential the provider interpolated into it.
    // The log is where the diagnostic belongs and the credential is not part
    // of the diagnostic -- a process log is shipped to aggregators and read by
    // more people than the configuration is.
    expect(logged).toContain("Invalid key");
    expect(logged).not.toContain(SECRET);
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

describe("a test send the provider accepted and the server refused", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;

  /** Accepts the message, then names the only address it was given. */
  const refusingProvider = defineEmailProvider<{ apiKey: string }>({
    type: "refusing-test",
    label: "Refusing",
    configFields: [
      { name: "apiKey", label: "API Key", kind: "password", secret: true },
    ],
    parseConfig: input => input as { apiKey: string },
    createAdapter: () => ({
      send: (options: { to: string }) =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          rejected: [options.to],
        }),
    }),
  });

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(refusingProvider);
    const created = await service.createProvider({
      name: "Refusing",
      type: "refusing-test",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: SECRET },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
  });

  afterEach(() => {
    getEmailProviderRegistry().reset();
    sqlite.close();
  });

  it("is not reported as a successful test", async () => {
    // A test has exactly one destination, so a provider that refused it
    // delivered nothing — and the Test button exists to answer whether this
    // provider can deliver.
    const outcome = await service.testProvider(providerId, "nope@example.com");

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/refused the test recipient/i);
  });

  it("says the address was refused rather than that the send failed", async () => {
    // The two send an operator to different places: the provider and its
    // credentials, or the address they typed.
    const outcome = await service.testProvider(providerId, "nope@example.com");

    expect(outcome.error).not.toMatch(/Send returned unsuccessful/);
  });

  it("still reports a test the provider accepted", async () => {
    // The control. `rejected` naming some OTHER address says nothing about
    // this test's destination, and must not fail it.
    getEmailProviderRegistry().reset();
    getEmailProviderRegistry().register(
      defineEmailProvider<{ apiKey: string }>({
        type: "refusing-test",
        label: "Refusing",
        configFields: [
          { name: "apiKey", label: "API Key", kind: "password", secret: true },
        ],
        parseConfig: input => input as { apiKey: string },
        createAdapter: () => ({
          send: () =>
            Promise.resolve({
              success: true,
              messageId: "msg-1",
              rejected: ["someone-else@example.com"],
            }),
        }),
      })
    );

    const outcome = await service.testProvider(providerId, "yes@example.com");

    expect(outcome.success).toBe(true);
  });
});

describe("a test-send id built out of the test message itself", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;
  const recorded: Array<{ messageId: string | null }> = [];

  /** Returns an id carrying a long span of the body it was handed. */
  const echoingProvider = defineEmailProvider<{ apiKey: string }>({
    type: "echoing-test",
    label: "A Very Distinctive Provider Name",
    configFields: [
      { name: "apiKey", label: "API Key", kind: "password", secret: true },
    ],
    parseConfig: input => input as { apiKey: string },
    createAdapter: () => ({
      send: (options: { html: string }) =>
        Promise.resolve({
          success: true,
          // The body interpolates the provider's name, so this is content
          // from the message rather than an identifier of its own.
          messageId: `sent-${options.html.slice(options.html.indexOf("<strong>") + 8, options.html.indexOf("</strong>"))}`,
        }),
    }),
  });

  beforeEach(async () => {
    recorded.length = 0;
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(echoingProvider);
    const created = await service.createProvider({
      name: "A Very Distinctive Provider Name",
      type: "echoing-test",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: SECRET },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: { messageId: string | null }) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: (inputs: Array<{ messageId: string | null }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };
  });

  afterEach(() => {
    getEmailProviderRegistry().reset();
    sqlite.close();
  });

  it("is not stored in the delivery row", async () => {
    // The ordinary send path keeps subject and body values out of every sink.
    // This path checked only the recipient, so the shorter route stored what
    // the longer one refuses.
    await service.testProvider(providerId, "someone@example.com");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.messageId).toBeNull();
  });
});

describe("a test recipient the caller wrote with a display name", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;

  /** Accepts the message and refuses the address, as SMTP reports it: bare. */
  const refusingProvider = defineEmailProvider<{ apiKey: string }>({
    type: "display-refusing",
    label: "Refusing",
    configFields: [
      { name: "apiKey", label: "API Key", kind: "password", secret: true },
    ],
    parseConfig: input => input as { apiKey: string },
    createAdapter: () => ({
      send: (options: { to: string }) =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          // The MAILBOX, which is the form a server answers `RCPT TO` in.
          rejected: [options.to.replace(/^.*<|>.*$/g, "")],
        }),
    }),
  });

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(refusingProvider);
    const created = await service.createProvider({
      name: "Refusing",
      type: "display-refusing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: SECRET },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
  });

  afterEach(() => {
    getEmailProviderRegistry().reset();
    sqlite.close();
  });

  it("is matched against the refusal despite the display name", async () => {
    // A caller may write `Jane <jane@example.com>` and SMTP answers with the
    // bare address, so comparing the strings as written never matches — and
    // the Test button reports success for the one recipient that was refused.
    const outcome = await service.testProvider(
      providerId,
      "Jane <jane@example.com>"
    );

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/refused the test recipient/i);
  });

  it("still reports success when nothing was refused", async () => {
    // The control: normalising both sides must not make every test fail.
    getEmailProviderRegistry().reset();
    getEmailProviderRegistry().register(
      defineEmailProvider<{ apiKey: string }>({
        type: "display-refusing",
        label: "Refusing",
        configFields: [
          { name: "apiKey", label: "API Key", kind: "password", secret: true },
        ],
        parseConfig: input => input as { apiKey: string },
        createAdapter: () => ({
          send: () => Promise.resolve({ success: true, messageId: "msg-1" }),
        }),
      })
    );

    const outcome = await service.testProvider(
      providerId,
      "Jane <jane@example.com>"
    );

    expect(outcome.success).toBe(true);
  });
});

describe("a test send that THREW, addressed with a display name", () => {
  it("records the mailbox, as the resolved path does", async () => {
    // Both paths record a delivery for one destination, and the normalisation
    // reached only the resolved one — so a thrown test stored the hash of
    // `Jane <jane@example.com>` while every reader hashes the bare address,
    // and the row could never be found again.
    const recorded: Array<{ to: string }> = [];
    const sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    const service = new EmailProviderService(
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

    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: { to: string }) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: (inputs: Array<{ to: string }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };
    (service as unknown as { createAdapterFromProvider: unknown })[
      "createAdapterFromProvider"
    ] = () => ({
      send: () => Promise.reject(new Error("the relay refused the connection")),
    });

    await service.testProvider(created.id, "Jane <jane@example.com>");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.to).toBe("jane@example.com");

    getEmailProviderRegistry().reset();
    sqlite.close();
  });
});

describe("a parser that changes what a credential looks like", () => {
  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  /**
   * A provider whose adapter interpolates the credential it was BUILT with.
   *
   * `parseConfig` is what stands between the stored configuration and the
   * adapter, so the value the adapter holds is the parser's output — and that
   * is the only value it can put into an identifier.
   */
  function pinnedProvider(
    parse: (input: unknown) => Record<string, unknown>,
    render: (config: Record<string, unknown>) => string
  ) {
    return defineEmailProvider({
      type: "pinned",
      label: "Pinned",
      configFields: [
        {
          name: "pin",
          label: "PIN",
          kind: "text",
          required: true,
          secret: true,
        },
      ],
      parseConfig: parse,
      createAdapter: config => ({
        send: () =>
          Promise.resolve({ success: true, messageId: render(config) }),
      }),
    });
  }

  it("withholds an id when parsing leaves the credential too short to compare", async () => {
    // A numeric coercion turns `"00007"` into `7`. The stored form is five
    // characters and compares perfectly well; the form the adapter actually
    // holds is one character, which cannot be used as a needle without
    // deleting every identifier that happens to contain a digit. Reading
    // comparability from the stored side alone answers for a value nobody
    // uses, and `id-7` goes back to the caller.
    const provider = pinnedProvider(
      input => ({ pin: Number((input as { pin: string }).pin) }),
      config => `id-${String(config.pin)}`
    );

    const adapter = provider.createAdapterFrom({ pin: "00007" });
    const result = await adapter.send({
      to: "a@b.com",
      from: "c@d.com",
      subject: "s",
      html: "<p>h</p>",
    });

    expect(result.messageId).toBeUndefined();
  });

  it("keeps an id from a provider whose parser only fills in defaults", async () => {
    // The control, and the reason comparability is read from the parsed side
    // while SHAPE is not. A parser adding keys the descriptor never declared
    // is the ordinary way to write one, and treating that as unmatchable
    // withholds every identifier from every provider that has a default.
    const provider = pinnedProvider(
      input => ({
        pin: (input as { pin: string }).pin,
        region: "us-east-1",
        retries: 3,
      }),
      () => "message-id-from-the-provider"
    );

    const adapter = provider.createAdapterFrom({ pin: "8419573026" });
    const result = await adapter.send({
      to: "a@b.com",
      from: "c@d.com",
      subject: "s",
      html: "<p>h</p>",
    });

    expect(result.messageId).toBe("message-id-from-the-provider");
  });

  it("still withholds an id that contains the parsed credential", async () => {
    // The other control. A credential long enough to compare is compared in
    // its EFFECTIVE form, so a parser that rewrites rather than shortens is
    // still caught — the change above must not have replaced that check.
    const provider = pinnedProvider(
      input => ({
        pin: `derived-${(input as { pin: string }).pin}`,
      }),
      config => `id-${String(config.pin)}`
    );

    const adapter = provider.createAdapterFrom({ pin: "8419573026" });
    const result = await adapter.send({
      to: "a@b.com",
      from: "c@d.com",
      subject: "s",
      html: "<p>h</p>",
    });

    expect(result.messageId).toBeUndefined();
  });
});
