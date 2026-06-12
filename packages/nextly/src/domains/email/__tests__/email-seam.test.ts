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
});
