/**
 * What names a keyed send, and the claim that holds its key.
 *
 * The message digest is what refuses a key reused for another message, so each
 * field that reaches the provider is changed in turn and must change it; the
 * provider key is derived per call and never carries the caller's key; and the
 * claim store answers a repeat, a failure and a site that keeps no history as
 * the contract says, on a real SQLite table built from the shipped schema.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { resolveEmailRetentionConfig } from "../retention-config";
import {
  assertIdempotencyKey,
  claimSendKey,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  providerKeyFor,
  scopedSender,
  sendKeyOf,
  type ClaimedMessage,
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
  const digestOf = (message: ClaimedMessage) =>
    sendKeyOf("site", "order-1", message).messageDigests[0];

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

  it("names the key by its scope too, so two callers' keys differ", () => {
    expect(sendKeyOf("plugin:a", "k", MESSAGE).keyDigests[0]).not.toBe(
      sendKeyOf("plugin:b", "k", MESSAGE).keyDigests[0]
    );
  });

  it("stores neither the key nor an address in a digest", () => {
    const sendKey = sendKeyOf("site", "order-1:a@example.com", MESSAGE);
    for (const digest of [...sendKey.keyDigests, ...sendKey.messageDigests]) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("the key a provider is handed", () => {
  const sendKey = sendKeyOf("site", "order-1:a@example.com", MESSAGE);

  it("is the same for the same call, and never the caller's key", () => {
    const key = providerKeyFor(sendKey, MESSAGE);
    expect(providerKeyFor(sendKey, MESSAGE)).toBe(key);
    expect(key).toMatch(/^nextly-[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(MAX_IDEMPOTENCY_KEY_LENGTH);
  });

  it("differs between the calls of a split send", () => {
    expect(providerKeyFor(sendKey, { to: ["a@example.com"] })).not.toBe(
      providerKeyFor(sendKey, { to: ["b@example.com"] })
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

  function service(maxAgeMs: number | false = 90 * 86_400_000) {
    return new EmailDeliveryService(adapter(), logger, undefined, () =>
      resolveEmailRetentionConfig({ maxAgeMs })
    );
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
    const spec = tables.find(table => table.name === "email_send_claims");
    if (!spec) expect.fail("email_send_claims is absent from the core schema");
    sqlite.exec(
      `CREATE TABLE "email_send_claims" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
    );
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

  it("refuses to claim inside an open transaction, writing nothing", async () => {
    openTransaction = true;

    await expect(
      claimSendKey(adapter(), sendKeyOf("site", "k", MESSAGE))
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(claims()).toEqual([]);
  });
});
