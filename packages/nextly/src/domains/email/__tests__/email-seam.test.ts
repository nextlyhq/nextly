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

describe("a message id that carries a recipient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  /**
   * A provider that builds its identifier out of the address it was handed,
   * with a `beforeSend` filter supplying a BCC the caller never wrote.
   *
   * The hidden recipient is what makes this a disclosure rather than an
   * echo: the caller cannot already know the address, so anything that hands
   * the id back tells them.
   */
  function sendWithIdDerivedFromABccRecipient() {
    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (payload: Record<string, unknown>) => ({
        ...payload,
        bcc: ["hidden-auditor@b.com"],
      })
    );

    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "delivery-hidden-auditor@b.com-42",
        }),
    });
    return service;
  }

  it("is withheld from the value the caller gets back", async () => {
    // Both send routes spread this straight into an HTTP response.
    const service = sendWithIdDerivedFromABccRecipient();

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("hidden-auditor@b.com");
  });

  it("is withheld from the after-send actions", async () => {
    // A plugin action is code the install chose to run, but the address still
    // did not come from it. An action that forwards or persists its argument
    // — a webhook, an analytics call — carries the hidden BCC to wherever it
    // sends, which is a disclosure by a route the caller never sees.
    const captured: Array<Record<string, unknown>> = [];
    const service = sendWithIdDerivedFromABccRecipient();
    getFilterRegistry().addAction(
      FilterSeams.EmailAfterSend,
      (value: Record<string, unknown>) => {
        captured.push(value);
      }
    );

    await service.send({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });

    expect(JSON.stringify(captured)).not.toContain("hidden-auditor@b.com");
  });

  it("is withheld from the send log", async () => {
    // A log line is durable and read by more people than the mailbox is.
    const service = sendWithIdDerivedFromABccRecipient();

    await service.send({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });

    const sent = vi
      .mocked(logger.info)
      .mock.calls.filter(([message]) => message === "email.sent");
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toContain("hidden-auditor@b.com");
  });

  it("still returns an ordinary id untouched", async () => {
    // The control. An RFC-form Message-ID contains an `@` and must survive:
    // a rule that dropped every id with an address shape in it would pass the
    // three cases above while destroying the field for every real provider.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "<20260811.abc123@mail.provider.test>",
        }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBe("<20260811.abc123@mail.provider.test>");
  });
});

describe("a send whose primary recipient was refused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  /** A provider that accepts the message but names an address it would not take. */
  function refusing(rejected: string[]) {
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({ success: true, messageId: "msg-1", rejected }),
    });
    return service;
  }

  it("is not reported to the caller as a success", async () => {
    // `AuthService` assigns this to `delivered` and withholds a password-reset
    // token from the response when it is true. A user the server refused would
    // otherwise be told the mail was sent and left with no way to continue.
    const service = refusing(["primary@b.com"]);

    const result = await service.send({
      to: "primary@b.com",
      subject: "Reset",
      html: "<p>x</p>",
    });

    expect(result.success).toBe(false);
  });

  it("agrees with the row already written for that address", async () => {
    // The delivery table was per-recipient and correct while the returned
    // value was message-level, so one send produced two different answers to
    // the same question.
    const recorded: Array<{ to: string; status: string }> = [];
    const service = refusing(["primary@b.com"]);
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: { to: string; status: string }) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: (inputs: Array<{ to: string; status: string }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };

    const result = await service.send({
      to: "primary@b.com",
      subject: "Reset",
      html: "<p>x</p>",
    });

    expect(recorded).toEqual([
      expect.objectContaining({ to: "primary@b.com", status: "failed" }),
    ]);
    expect(result.success).toBe(false);
  });

  it("is not rescued by a copy the caller never asked for", async () => {
    // A `beforeSend` filter adding a BCC must not turn a refused primary into
    // a successful send: the address the caller wrote is the one the answer is
    // about.
    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (payload: Record<string, unknown>) => ({
        ...payload,
        bcc: ["archive@b.com"],
      })
    );
    const service = refusing(["primary@b.com"]);

    const result = await service.send({
      to: "primary@b.com",
      subject: "Reset",
      html: "<p>x</p>",
    });

    expect(result.success).toBe(false);
  });

  it("still succeeds when only a CC was refused", async () => {
    // The control. The caller's recipient received the message, so this is a
    // successful send with one copy undelivered — and the CC's own row still
    // records the refusal.
    const service = refusing(["cc@b.com"]);

    const result = await service.send({
      to: "primary@b.com",
      cc: ["cc@b.com"],
      subject: "Notice",
      html: "<p>x</p>",
    });

    expect(result.success).toBe(true);
  });

  it("still succeeds when nothing was refused", async () => {
    // The second control: the rule must not make every send a failure.
    const service = refusing([]);

    const result = await service.send({
      to: "primary@b.com",
      subject: "Notice",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true, messageId: "msg-1" });
  });
});

describe("a message id built out of the message that was sent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  /** A provider that returns whatever it is told to. */
  function returning(messageId: string) {
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({ send: () => Promise.resolve({ success: true, messageId }) });
    return service;
  }

  it("is not stored, because it is not shaped like an identifier", async () => {
    // The risk this exists for: a provider is handed the subject and body, and
    // a password-reset body contains a single-use token. An id built out of
    // that is longer and more varied than any identifier shape, so it fails
    // the shape rule without anything having to inspect its contents.
    const service = returning(
      "Reset your password using code 8f3a91c4e7b20d65 right away"
    );

    const result = await service.send({
      to: "a@b.com",
      subject: "Reset your password",
      html: "<p>Use code 8f3a91c4e7b20d65</p>",
    });

    expect(result.messageId).toBeUndefined();
  });

  it("is not stored when the provider echoes a long token", async () => {
    // A 64-character token is what `randomBytes(32).toString(\"hex\")` produces,
    // which is what this repository's own reset tokens are.
    const service = returning(`sent-${"a1b2c3d4".repeat(8)}`);

    const result = await service.send({
      to: "a@b.com",
      subject: "Confirm",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBeUndefined();
  });

  it("keeps the three shapes real providers return", async () => {
    // The control, and the reason the rule is a shape rather than a length:
    // these are what SMTP, Resend and a provider with its own scheme return,
    // and all three have to survive or the field is worthless.
    for (const id of [
      "<20260811.abc123@mail.acmemail.test>",
      "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
      "sl-1",
    ]) {
      const result = await returning(id).send({
        to: "a@b.com",
        subject: "Hi",
        html: "<p>x</p>",
      });
      expect(result.messageId).toBe(id);
    }
  });

  it("still withholds a recognised shape that carries a recipient", async () => {
    // The shape rule replaces the question that had no exact answer. It does
    // not replace the one that does: the recipients are known, so they are
    // compared exactly.
    const service = returning("<a@b.com>");

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBeUndefined();
  });
});

describe("a failure AFTER the provider accepted the message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
    // `clearAllMocks` clears CALLS, not implementations, and these tests
    // install loggers that throw. Left in place they would follow the shared
    // logger into every later test in the file.
    vi.mocked(logger.info).mockReset();
    vi.mocked(logger.warn).mockReset();
    vi.mocked(logger.error).mockReset();
  });

  it("is not reported as a provider failure", async () => {
    // An installed logger that throws runs after the rows and the after-send
    // action have already gone out. Treating it as a provider failure writes a
    // SECOND set of failed rows, runs the action again with `success: false`,
    // and tells an auth flow to withhold a token for a message that was sent.
    const { service } = buildSend();
    const captured: Array<Record<string, unknown>> = [];
    getFilterRegistry().addAction(
      FilterSeams.EmailAfterSend,
      (value: Record<string, unknown>) => {
        captured.push(value);
      }
    );

    const recorded: Array<{ status: string }> = [];
    (service as unknown as { deliveries: unknown })["deliveries"] = {
      record: (input: { status: string }) => {
        recorded.push(input);
        return Promise.resolve();
      },
      recordAll: (inputs: Array<{ status: string }>) => {
        recorded.push(...inputs);
        return Promise.resolve();
      },
    };
    // Throws only on the success line, which runs after everything above it.
    vi.mocked(logger.info).mockImplementation((message: string) => {
      if (message === "email.sent") throw new Error("log transport is down");
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true, messageId: "msg-1" });
    expect(recorded.map(row => row.status)).toEqual(["sent"]);
    expect(captured.map(value => value.success)).toEqual([true]);
  });

  it("survives a logger that throws from the recovery path too", async () => {
    // The thing being reported may BE the logger, so a transport that threw
    // once throws again inside the catch -- rejecting an accepted send for the
    // second time, which is the outcome the recovery branch exists to prevent.
    const { service } = buildSend();
    vi.mocked(logger.info).mockImplementation(() => {
      throw new Error("log transport is down");
    });
    vi.mocked(logger.error).mockImplementation(() => {
      throw new Error("log transport is still down");
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true, messageId: "msg-1" });
  });

  it("still reports a provider that never accepted the message", async () => {
    // The control. The marker must not swallow a real send failure.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () => Promise.reject(new Error("smtp down")),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: false });
  });
});

describe("a message id built to cost us something", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  it("does not let a separator-heavy id stall the send path", async () => {
    // Candidate generation once produced every contiguous span of an id's
    // segments, which is quadratic in their number — a 1,000-segment id took
    // 426ms before the send could return, and nothing bounds a provider's
    // identifier. Only the shortest qualifying span per starting segment is
    // produced now, which detects the same texts: a longer span from the same
    // start carries the short one as a prefix.
    const { service } = buildSend();
    const heavy = Array.from({ length: 300 }, (_, i) => `s${i}`).join("-");
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () => Promise.resolve({ success: true, messageId: heavy }),
    });

    const started = Date.now();
    await service.send({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });

    // Generous by three orders of magnitude against the quadratic form, so
    // this fails on the shape of the algorithm rather than on a slow machine.
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("withholds an id longer than a header line may be", async () => {
    // RFC 5322 caps a header line at 998 octets, so this is not a Message-ID.
    // Refused rather than inspected: it is already outside the contract.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({ success: true, messageId: "x".repeat(1200) }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBeUndefined();
  });

  it("still returns an id of ordinary length", async () => {
    // The control for the bound.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: `<${"a".repeat(300)}@m.test>`,
        }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBe(`<${"a".repeat(300)}@m.test>`);
  });
});

describe("a message id built out of something the caller did not publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  function returning(messageId: string) {
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({ send: () => Promise.resolve({ success: true, messageId }) });
    return service;
  }

  it("withholds one carrying a hidden recipient's local part", async () => {
    // The domain may be shared with everyone on the message; the local part is
    // what names the person. A provider building an id out of an address
    // rarely keeps the domain, and an `email.beforeSend` filter can add a BCC
    // the caller never wrote — so this is an address the caller cannot
    // already know.
    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (payload: Record<string, unknown>) => ({
        ...payload,
        bcc: ["hidden-auditor@example.com"],
      })
    );
    const service = returning("id-hidden-auditor");

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBeUndefined();
  });

  it("keeps one that merely shares a common short word", async () => {
    // The control for the length floor. Dropping every id containing `bob`
    // would cost the field for nothing.
    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (payload: Record<string, unknown>) => ({
        ...payload,
        bcc: ["bob@example.com"],
      })
    );
    const service = returning("bobsled-42");

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.messageId).toBe("bobsled-42");
  });
});

describe("a provider that returns no identifier at all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  it("treats a null message id as absent rather than throwing", async () => {
    // A JavaScript plugin or a hand-built provider is not bound by the
    // adapter's declared return type, and `null` is the natural way to say
    // "accepted, no identifier". Reading `.length` off it threw on the send
    // path, which the catch above then reported as a provider failure — an
    // accepted message turned into a failed one.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({ success: true, messageId: null } as unknown as {
          success: boolean;
          messageId?: string;
        }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true });
  });
});

describe("a provider that reports refusals the way its transport does", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFilterRegistry();
  });

  afterEach(() => {
    resetFilterRegistry();
  });

  it("reads an envelope-style entry rather than throwing on it", async () => {
    // Nodemailer reports either a plain string or an object depending on how
    // the message was addressed, so a provider forwarding its transport's
    // array untouched hands over objects. Reading `.trim()` off one throws
    // AFTER the provider has already sent — turning a delivered message into a
    // failure, which is the one outcome worse than mis-recording it.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          rejected: [{ address: "a@b.com", name: "" }],
        } as unknown as { success: boolean; messageId?: string }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    // The refusal is UNDERSTOOD, not merely survived: the primary recipient
    // was refused, so the send did not reach the caller's address.
    expect(result.success).toBe(false);
  });

  it("ignores an entry that names no address", async () => {
    // An unreadable entry matches nothing and so refuses nobody. The
    // alternative — treating it as a refusal — would fail a send on the
    // strength of a value the provider did not manage to name.
    const { service } = buildSend();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "msg-1",
          rejected: [{ nothing: true }, null],
        } as unknown as { success: boolean; messageId?: string }),
    });

    const result = await service.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true, messageId: "msg-1" });
  });
});
