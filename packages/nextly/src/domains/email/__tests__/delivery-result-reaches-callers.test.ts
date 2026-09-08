/**
 * Tests that a failed delivery is observable by the caller that needs to know.
 *
 * `EmailService.send()` converts a provider throw into `{ success: false }`
 * rather than propagating it. That is the right contract for an application
 * caller, but it means the three auth convenience wrappers — which returned
 * `void` — discarded the only evidence that nothing was delivered. A caller
 * whose next decision depends on delivery then treats a failed send as a
 * completed one.
 *
 * The wrappers now return the send result. Widening `void` is deliberately
 * additive: an existing caller that ignores the value keeps compiling and
 * behaving identically, which matters for a published package.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { EmailProviderAdapter } from "../types";

import { EmailService } from "../services/email-service";

// `lib/env` only re-exports this module, and `getBaseUrl` reaches the real one
// directly — so mocking the re-export alone leaves env validation running.
vi.mock("../../../shared/lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** Minimal template service: always misses, so the code-first path is used. */
function makeTemplateService() {
  return {
    getTemplateBySlug: vi.fn().mockResolvedValue(null),
    getLayoutFor: vi.fn().mockResolvedValue(null),
  };
}

/** Provider service with no DB providers, so code-first config is resolved. */
function makeProviderService() {
  return {
    getProviderDecrypted: vi.fn(),
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue(null),
  };
}

function makeService(adapter: EmailProviderAdapter) {
  const emailConfig = {
    providerConfig: { provider: "resend" as const, apiKey: "re_x" },
    from: "App <noreply@example.com>",
    templates: {
      passwordReset: () => ({ subject: "Reset", html: "<p>reset</p>" }),
      emailVerification: () => ({ subject: "Verify", html: "<p>verify</p>" }),
      welcome: () => ({ subject: "Welcome", html: "<p>welcome</p>" }),
    },
  };

  const service = new EmailService(
    {} as never,
    logger as never,
    makeProviderService() as never,
    makeTemplateService() as never,
    emailConfig
  );

  // Resolve every provider to the adapter under test, so these tests exercise
  // the wrapper -> sendWithTemplate -> send path and not provider resolution.
  vi.spyOn(
    service as unknown as {
      resolveProvider: () => Promise<unknown>;
    },
    "resolveProvider"
  ).mockResolvedValue({
    adapter,
    from: "App <noreply@example.com>",
    providerType: "resend",
  });

  return service;
}

const USER = { name: "Ada", email: "ada@example.com" };

describe("delivery failure reaches the caller", () => {
  beforeEach(() => {
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  it("reports success when the provider delivered", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true, messageId: "m1" }),
    };

    const result = await makeService(adapter).sendPasswordResetEmail(
      USER.email,
      USER,
      "tok"
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("m1");
  });

  it("reports failure when the provider threw, instead of returning void", async () => {
    // This is the defect: the adapter throws, send() swallows it into
    // { success: false }, and the wrapper used to return undefined — so the
    // caller could not tell this apart from a delivered message.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockRejectedValue(new Error("SMTP 535 auth failed")),
    };

    const result = await makeService(adapter).sendPasswordResetEmail(
      USER.email,
      USER,
      "tok"
    );

    expect(result.success).toBe(false);
  });

  it("reports failure when the provider returned an unsuccessful result", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: false }),
    };

    const result = await makeService(adapter).sendPasswordResetEmail(
      USER.email,
      USER,
      "tok"
    );

    expect(result.success).toBe(false);
  });

  it("reports failure from the email-verification wrapper too", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockRejectedValue(new Error("network down")),
    };

    const result = await makeService(adapter).sendEmailVerificationEmail(
      USER.email,
      USER,
      "tok"
    );

    expect(result.success).toBe(false);
  });

  it("reports failure from the welcome wrapper too", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockRejectedValue(new Error("network down")),
    };

    const result = await makeService(adapter).sendWelcomeEmail(
      USER.email,
      USER
    );

    expect(result.success).toBe(false);
  });

  it("still resolves rather than throwing, so fire-and-forget callers are unaffected", async () => {
    // user-mutation-service sends the welcome mail as a side effect and must
    // not fail user creation because delivery did. Widening the return type
    // must not turn a swallowed failure into a thrown one.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockRejectedValue(new Error("boom")),
    };

    await expect(
      makeService(adapter).sendWelcomeEmail(USER.email, USER)
    ).resolves.toBeDefined();
  });
});
