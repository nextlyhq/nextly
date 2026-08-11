/**
 * Email filter/action seam tests (D63).
 *
 * Verifies that `email.beforeSend` filters transform the payload before
 * dispatch and that `email.afterSend` actions fire with the send result.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getFilterRegistry,
  resetFilterRegistry,
  FilterSeams,
} from "../../../filters";
import type { Logger } from "../../../shared/types";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import type { EmailProviderAdapter } from "../types";

// Bypass env loader — the service doesn't touch env during send().
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeAdapter(): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => ({}) as never,
    getCapabilities: () => ({ dialect: "sqlite" as const }) as never,
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
  } as unknown as DrizzleAdapter;
}

function buildSend() {
  const adapterSend = vi
    .fn<EmailProviderAdapter["send"]>()
    .mockResolvedValue({ success: true, messageId: "msg-1" });
  const providerAdapter: EmailProviderAdapter = { send: adapterSend };

  const providerService = {
    getProviderDecrypted: vi.fn(),
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
      id: "p1",
      type: "resend",
      fromEmail: "no-reply@test.local",
      fromName: null,
      configuration: { apiKey: "k" },
      isActive: true,
    }),
  } as unknown as EmailProviderService;

  const templateService = {
    getTemplateBySlug: vi.fn(),
    getLayout: vi.fn(),
  } as unknown as EmailTemplateService;

  const service = new EmailService(
    makeAdapter(),
    logger,
    providerService,
    templateService,
    undefined,
    undefined
  );

  // Replace the adapter-from-record factory so send() delegates to our mock.
  (service as unknown as { createAdapterFromRecord: unknown })[
    "createAdapterFromRecord"
  ] = () => providerAdapter;

  return { service, adapterSend };
}

describe("EmailService — D63 filter/action seams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  it("email.beforeSend filter transforms the payload before dispatch", async () => {
    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (e: { subject: string }) => ({ ...e, subject: `[TAGGED] ${e.subject}` })
    );

    const { service, adapterSend } = buildSend();
    await service.send({
      to: "a@b.com",
      subject: "Hello",
      html: "<p>x</p>",
    });

    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "[TAGGED] Hello",
        from: "no-reply@test.local",
      })
    );
  });

  it("email.afterSend action fires with the send result", async () => {
    const captured: unknown[] = [];
    getFilterRegistry().addAction(FilterSeams.EmailAfterSend, payload => {
      captured.push(payload);
    });

    const { service } = buildSend();
    await service.send({
      to: "a@b.com",
      subject: "Hello",
      html: "<p>x</p>",
    });

    expect(captured).toEqual([
      expect.objectContaining({
        to: "a@b.com",
        subject: "Hello",
        success: true,
        messageId: "msg-1",
      }),
    ]);
  });

  it("no filters registered — payload passes through unchanged", async () => {
    const { service, adapterSend } = buildSend();
    await service.send({
      to: "a@b.com",
      subject: "Hello",
      html: "<p>x</p>",
    });

    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Hello",
        from: "no-reply@test.local",
      })
    );
  });

  it("email.afterSend action fires with success:false when adapter throws", async () => {
    const captured: unknown[] = [];
    getFilterRegistry().addAction(FilterSeams.EmailAfterSend, payload => {
      captured.push(payload);
    });

    const adapterSend = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockRejectedValue(new Error("smtp down"));
    const providerAdapter: EmailProviderAdapter = { send: adapterSend };

    const providerService = {
      getProviderDecrypted: vi.fn(),
      getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
        id: "p1",
        type: "resend",
        fromEmail: "no-reply@test.local",
        fromName: null,
        configuration: { apiKey: "k" },
        isActive: true,
      }),
    } as unknown as EmailProviderService;

    const templateService = {
      getTemplateBySlug: vi.fn(),
      getLayout: vi.fn(),
    } as unknown as EmailTemplateService;

    const service = new EmailService(
      makeAdapter(),
      logger,
      providerService,
      templateService,
      undefined,
      undefined
    );

    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => providerAdapter;

    const result = await service.send({
      to: "fail@b.com",
      subject: "Failing",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: false });
    expect(captured).toEqual([expect.objectContaining({ success: false })]);
  });

  it("returns only what it promises, never the provider's extra fields", async () => {
    // Both send routes spread this straight into an HTTP response, and
    // `rejected` carries addresses — including BCC recipients a beforeSend
    // filter added. A contributed provider holding decrypted configuration can
    // put anything else on the object too.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          rejected: ["secret-bcc@b.com"],
          somethingElse: "should not travel",
        }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    // toEqual, not toMatchObject: the point is what is ABSENT.
    expect(result).toEqual({ success: true, messageId: "msg-1" });
  });

  it("records the mailbox when the caller wrote a display name", async () => {
    // A provider dispatches `Display Name <user@example.com>` to the mailbox,
    // and so does the person asking support whether a message arrived — a hash
    // of the display form answers "no record" for a message that was sent.
    // Nodemailer reports refusals as bare mailboxes too, which is why the
    // refused CC below matches at all.
    const recorded: Array<{ to: string; status: string }> = [];
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          rejected: ["refused@b.com"],
        }),
    });
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      recordAll: (inputs: Array<{ to: string; status: string }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };

    await service.send({
      to: "Primary Person <a@b.com>",
      cc: ["Refused Person <refused@b.com>"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(recorded).toEqual([
      expect.objectContaining({ to: "a@b.com", status: "sent" }),
      expect.objectContaining({ to: "refused@b.com", status: "failed" }),
    ]);
  });

  it("does not store a message id that carries the recipient", async () => {
    // The adapter is handed `options.to` and may build its identifier from it.
    // The error string is redacted for that reason; this column was not, so an
    // id like `delivery-user@example.com` would put the recipient in the table
    // that otherwise stores only a hash of them.
    const recorded: Array<{ messageId: string | null }> = [];
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "delivery-a@b.com-20260811",
        }),
    });
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      recordAll: (inputs: Array<{ messageId: string | null }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };

    await service.send({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });

    expect(recorded[0]?.messageId).toBeNull();
  });

  it("keeps an ordinary RFC-form message id", async () => {
    // The control, and the reason this is a comparison rather than
    // address-shaped redaction: a Message-ID legitimately contains an `@`, so
    // a shape rule would discard nearly every real id.
    const recorded: Array<{ messageId: string | null }> = [];
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({ success: true, messageId: "<abc@mail.example.com>" }),
    });
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      recordAll: (inputs: Array<{ messageId: string | null }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };

    await service.send({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });

    expect(recorded[0]?.messageId).toBe("<abc@mail.example.com>");
  });

  it("records a refused recipient as failed while the others succeed", async () => {
    // SMTP answers `RCPT TO` one address at a time, so a server can accept the
    // message for some recipients and refuse it for others while the send as a
    // whole succeeds. A row saying `sent` for a refused address would claim
    // someone received a message that never went to them.
    const recorded: Array<{ to: string; status: string }> = [];
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          rejected: ["Refused@B.com"],
        }),
    });
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      recordAll: (inputs: Array<{ to: string; status: string }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };

    await service.send({
      to: "a@b.com",
      cc: ["refused@b.com"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    // Matched case-insensitively, because a server echoes the address in
    // whatever case it received it.
    expect(recorded).toEqual([
      expect.objectContaining({ to: "a@b.com", status: "sent" }),
      expect.objectContaining({ to: "refused@b.com", status: "failed" }),
    ]);
  });

  it.each([
    ["accepts the message", { success: true, messageId: "msg-1" }, undefined],
    ["throws", undefined, new Error("smtp down")],
  ])(
    "records the delivery before running plugin actions when the provider %s",
    async (_case, resolved, rejection) => {
      // `runActions` awaits every registered handler in turn. Isolation stops
      // a thrower from breaking the send, but it cannot stop a handler that
      // blocks on network I/O from outliving the request — and a message the
      // provider has already accepted would then have no durable record. The
      // order is the guarantee, so the order is what this pins.
      const order: string[] = [];
      getFilterRegistry().addAction(FilterSeams.EmailAfterSend, () => {
        order.push("action");
      });

      const adapterSend = vi.fn<EmailProviderAdapter["send"]>();
      if (rejection) adapterSend.mockRejectedValue(rejection);
      else adapterSend.mockResolvedValue(resolved!);

      const { service } = buildSend();
      (service as unknown as { createAdapterFromRecord: unknown })[
        "createAdapterFromRecord"
      ] = () => ({ send: adapterSend });
      (service as unknown as { deliveries: unknown })["deliveries"] = {
        recordAll: async () => {
          order.push("record");
        },
      };

      await service.send({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });

      // The control: both steps ran, so this is an ordering assertion rather
      // than one satisfied by a step never happening.
      expect(order).toEqual(["record", "action"]);
    }
  );
});
