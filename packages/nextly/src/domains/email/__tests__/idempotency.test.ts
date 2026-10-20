/**
 * What names a keyed send, and the claim that holds its key.
 *
 * The message digest is what refuses a key reused for another message, so each
 * field that reaches the provider is changed in turn and must change it; the
 * provider key is derived per call and never carries the caller's key; and the
 * claim store answers a repeat, a failure and a site that keeps no history as
 * the contract says, on a real SQLite table built from the shipped schema.
 */

import { createHash } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCoreSchema } from "../../../schemas";
import { DELETED_PRINCIPALS_TABLE } from "../../../schemas/deleted-principals/table-name";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { resolveEmailRetentionConfig } from "../retention-config";
import {
  assertIdempotencyKey,
  claimSendKey,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  messageIdentity,
  scopedSender,
  sendKeyOf,
  type ClaimedMessage,
  type SendKey,
} from "../send-claims";
import { EmailDeliveryService } from "../services/email-delivery-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const FIRST_SECRET = "first-secret-long-enough-for-hmac-derivation";

const MESSAGE: ClaimedMessage = {
  to: ["a@example.com"],
  cc: ["c@example.com"],
  bcc: ["d@example.com"],
  from: "shop@example.com",
  replyTo: "reply@example.com",
  subject: "Your order",
  html: "<p>Thanks</p>",
  text: "Thanks",
  attachments: [
    {
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("receipt"),
    },
  ],
  person: { kind: "customer", id: "c-1" },
};

describe("the message a key names", () => {
  const digestOf = (message: ClaimedMessage) => messageIdentity(message);

  it("is the same message when nothing changed", () => {
    expect(digestOf({ ...MESSAGE })).toBe(digestOf(MESSAGE));
  });

  it.each<[string, Partial<ClaimedMessage>]>([
    ["a to address", { to: ["b@example.com"] }],
    ["another to address", { to: ["a@example.com", "b@example.com"] }],
    ["the cc", { cc: ["e@example.com"] }],
    ["the bcc", { bcc: [] }],
    ["from", { from: "other@example.com" }],
    ["replyTo", { replyTo: undefined }],
    ["the rendered subject", { subject: "Your order!" }],
    ["the rendered html", { html: "<p>Thanks!</p>" }],
    ["the rendered text", { text: "Thanks!" }],
    [
      "an attachment's bytes",
      {
        attachments: [
          {
            filename: "receipt.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("receipt v2"),
          },
        ],
      },
    ],
    [
      "an attachment's name",
      {
        attachments: [
          {
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("receipt"),
          },
        ],
      },
    ],
    ["the person", { person: { kind: "customer", id: "c-2" } }],
    ["no person", { person: null }],
  ])("is a different message when %s changes", (_field, change) => {
    expect(digestOf({ ...MESSAGE, ...change })).not.toBe(digestOf(MESSAGE));
  });

  it("names an attachment by its bytes alone, never by a secret", () => {
    // Digested under the claim's key as a whole, so the identity itself must
    // not change with the install's secret.
    expect(messageIdentity(MESSAGE)).toContain(
      createHash("sha256").update(Buffer.from("receipt")).digest("hex")
    );
  });
});

describe("a usable key", () => {
  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["too long", "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1)],
    ["not text", 42],
  ])("refuses a key that is %s", (_name, key) => {
    expect(() => assertIdempotencyKey(key)).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
  });

  it("takes a key of the longest length", () => {
    expect(() =>
      assertIdempotencyKey("k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH))
    ).not.toThrow();
  });
});

describe("the sender a surface hands on", () => {
  it("is scoped to the surface's caller", () => {
    const scopedTo = vi.fn((scope: string) => ({ scope }));
    expect(scopedSender({ scopedTo }, "plugin:shop")).toEqual({
      scope: "plugin:shop",
    });
  });

  it("is a service without scoping, or none, as it is", () => {
    const double = { send: vi.fn() };
    expect(scopedSender(double, "site")).toBe(double);
    expect(scopedSender(undefined, "site")).toBeUndefined();
  });
});

describe("the claim store", () => {
  let sqlite: Database.Database;
  let openTransaction: boolean;

  function adapter(): DrizzleAdapter {
    const db = drizzle({ client: sqlite });
    return {
      dialect: "sqlite" as const,
      getDrizzle: () => db,
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      transactionOpenInFlow: () => openTransaction,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ drizzleWithRelations: () => db }),
    } as unknown as DrizzleAdapter;
  }

  function service(
    maxAgeMs: number | false = 90 * 86_400_000,
    secrets: readonly string[] = [FIRST_SECRET]
  ) {
    return new EmailDeliveryService(
      adapter(),
      logger,
      undefined,
      () => resolveEmailRetentionConfig({ maxAgeMs }),
      () => secrets
    );
  }

  /** Claim a key, failing the test unless it was claimed. */
  async function held(store: EmailDeliveryService, sendKey: SendKey) {
    const decided = await store.claimSend(sendKey);
    if (decided.kind !== "claimed") expect.fail(decided.kind);
    return decided.claim;
  }

  const claims = () =>
    sqlite.prepare(`SELECT * FROM "email_send_claims"`).all() as Array<{
      state: string;
      result: string | null;
    }>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    openTransaction = false;
    const { tables } = getCoreSchema("sqlite");
    // The claims, and the tables the stored digest key lives in.
    for (const name of [
      "email_send_claims",
      "nextly_meta",
      DELETED_PRINCIPALS_TABLE,
    ]) {
      const spec = tables.find(table => table.name === name);
      if (!spec) expect.fail(`${name} is absent from the core schema`);
      sqlite.exec(
        `CREATE TABLE "${name}" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
      );
    }
  });

  afterEach(() => sqlite.close());

  it("answers a repeat of a successful send with its result, holding no address", async () => {
    const store = service();
    const sendKey = sendKeyOf("site", "k", MESSAGE);
    const first = await store.claimSend(sendKey);
    if (first.kind !== "claimed") expect.fail(first.kind);
    await store.settleSend(first.claim, {
      success: true,
      messageId: "m-1",
      refused: [{ kind: "cc", position: 0, retryable: false, status: 550 }],
    });

    await expect(store.claimSend(sendKey)).resolves.toEqual({
      kind: "repeat",
      result: {
        success: true,
        messageId: "m-1",
        refused: [{ kind: "cc", position: 0, retryable: false, status: 550 }],
      },
    });
    expect(JSON.stringify(claims())).not.toContain("@example.com");
  });

  it("lets the key be claimed again after a failure, for the same message only", async () => {
    const store = service();
    const sendKey = sendKeyOf("site", "k", MESSAGE);
    const first = await store.claimSend(sendKey);
    if (first.kind !== "claimed") expect.fail(first.kind);
    await store.settleSend(first.claim, { success: false });

    await expect(
      store.claimSend(sendKeyOf("site", "k", { ...MESSAGE, subject: "Other" }))
    ).resolves.toEqual({ kind: "different-message" });
    await expect(store.claimSend(sendKey)).resolves.toMatchObject({
      kind: "claimed",
    });
  });

  it("reports a key still being sent as in progress", async () => {
    const store = service();
    const sendKey = sendKeyOf("site", "k", MESSAGE);
    await store.claimSend(sendKey);

    await expect(store.claimSend(sendKey)).resolves.toEqual({
      kind: "in-progress",
    });
  });

  it("keeps no claim for a site that keeps no delivery history", async () => {
    const store = service(0);
    const first = await store.claimSend(sendKeyOf("site", "k", MESSAGE));
    if (first.kind !== "claimed") expect.fail(first.kind);
    await store.settleSend(first.claim, { success: true });

    expect(claims()).toEqual([]);
  });

  it("keeps two callers' keys apart and stores neither key nor address", async () => {
    const store = service();
    const key = "order-1:a@example.com";

    await held(store, sendKeyOf("plugin:a", key, MESSAGE));
    await held(store, sendKeyOf("plugin:b", key, MESSAGE));

    const rows = claims() as unknown as Array<Record<string, unknown>>;
    expect(rows.map(row => row.scope).sort()).toEqual(["plugin:a", "plugin:b"]);
    for (const row of rows) {
      expect(row.key_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(row.message_digest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(JSON.stringify(rows)).not.toContain("a@example.com");
  });

  it("hands a provider the same key for the same call, and another for another call", async () => {
    const claim = await held(service(), sendKeyOf("site", "order-1", MESSAGE));

    const key = claim.providerKey(MESSAGE);
    expect(claim.providerKey(MESSAGE)).toBe(key);
    expect(key).toMatch(/^nextly-[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(MAX_IDEMPOTENCY_KEY_LENGTH);
    expect(claim.providerKey({ to: ["a@example.com"] })).not.toBe(
      claim.providerKey({ to: ["b@example.com"] })
    );
  });

  it("names the send the same way across a secret rotation, and never claims it twice", async () => {
    // A rolling deployment: the new instance, with the old secret listed as
    // previous, reaches the claim the old one made. Once it has sealed the
    // stored key under the new secret, an instance still on the old one can
    // no longer read it and refuses the send: it never makes a second claim.
    const sendKey = sendKeyOf("site", "order-1", MESSAGE);
    const first = service();
    const claim = await held(first, sendKey);
    await first.settleSend(claim, { success: true, messageId: "m-1" });
    const rotated = service(undefined, [
      "second-secret-long-enough-for-hmac-derivation",
      FIRST_SECRET,
    ]);

    await expect(rotated.claimSend(sendKey)).resolves.toMatchObject({
      kind: "repeat",
    });
    await expect(service().claimSend(sendKey)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(claims()).toHaveLength(1);
  });

  it("refuses to claim inside an open transaction, writing nothing", async () => {
    openTransaction = true;

    await expect(
      claimSendKey(adapter(), sendKeyOf("site", "k", MESSAGE), [FIRST_SECRET])
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(claims()).toEqual([]);
  });
});
