/**
 * Sending with nothing configured, and what that must NOT change.
 *
 * A fresh install used to fail its first send with a 422, which lands on the
 * password-reset flow. The fallback keeps that flow working -- but it must stay
 * on the send path alone: auth reads `isConfigured()` to decide whether to
 * return a reset token in the response, so a fallback that made that answer
 * permanently yes would silently change an auth branch nobody edited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../services/shared";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { shouldIncludeBody } from "../services/providers/log-provider";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const adapter = {
  getDrizzle: () => ({}),
  dialect: "sqlite",
} as unknown as DrizzleAdapter;

const templateService = {
  getTemplateBySlug: vi.fn(),
  getLayout: vi.fn(),
} as unknown as EmailTemplateService;

/** An EmailService whose provider lookup finds nothing at all. */
function serviceWithNoProvider() {
  const providerService = {
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue(null),
    getProviderDecrypted: vi.fn().mockResolvedValue(null),
  } as unknown as EmailProviderService;

  return new EmailService(
    adapter,
    logger,
    providerService,
    templateService,
    undefined,
    undefined
  );
}

describe("body inclusion by environment", () => {
  it("includes the body outside production", () => {
    expect(shouldIncludeBody("development")).toBe(true);
    expect(shouldIncludeBody("test")).toBe(true);
    expect(shouldIncludeBody(undefined)).toBe(true);
  });

  it("excludes the body in production, where a reset token would be a leak", () => {
    expect(shouldIncludeBody("production")).toBe(false);
  });
});

describe("sending with no provider configured", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds through the log transport instead of throwing", async () => {
    const result = await serviceWithNoProvider().send({
      to: "person@example.com",
      subject: "Reset your password",
      html: "<p>reset</p>",
    });

    expect(result.success).toBe(true);
  });

  it("shows the log transport carried it, not a real provider", async () => {
    const result = await serviceWithNoProvider().send({
      to: "person@example.com",
      subject: "Reset your password",
      html: "<p>reset</p>",
    });

    // The separating property: a send that merely SUCCEEDED could have found a
    // real provider. Only this transport mints an id it can be recognised by,
    // so the prefix is what shows the message never left the process.
    expect(result.messageId).toMatch(/^log-/);
  });

  it("still reports the install as unconfigured", async () => {
    // The invariant the fallback must not break. `isConfigured` answers a
    // question about REAL providers, and auth changes behaviour on it.
    await expect(serviceWithNoProvider().isConfigured()).resolves.toBe(false);
  });

  it("propagates the failure when a specific provider was asked for", async () => {
    // Naming a provider that cannot be resolved is a real error. Swallowing it
    // into a log write would report a send as delivered that never went.
    await expect(
      serviceWithNoProvider().send({
        to: "person@example.com",
        subject: "s",
        html: "<p>h</p>",
        providerId: "missing-provider",
      })
    ).rejects.toThrow();
  });
});
