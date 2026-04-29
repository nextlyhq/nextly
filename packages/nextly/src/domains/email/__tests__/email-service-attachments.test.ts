/**
 * EmailService attachment integration tests.
 *
 * Verifies the glue between `send()`, the attachment resolver, and the
 * provider adapter. Edge-case coverage lives in `attachment-resolver.test.ts`
 * — these tests just make sure the wiring is correct.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Logger } from "../../../shared/types";
import type { EmailProviderService } from "../services/email-provider-service";
import type { EmailAttachmentSource } from "../services/email-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import type { EmailProviderAdapter } from "../types";

// Bypass env loader — the service doesn't touch env during send().
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET_RESOLVED: "test-secret-must-be-32chars-long!!",
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
    transaction: async <T>(fn: (tx: never) => Promise<T>) =>
      fn({} as never),
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

  const findMedia = vi.fn<
    (id: string) => Promise<{
      filename: string;
      originalFilename: string;
      mimeType: string;
    } | null>
  >().mockResolvedValue({
    filename: "storage/invoice.pdf",
    originalFilename: "invoice.pdf",
    mimeType: "application/pdf",
  });
  const readBytes = vi
    .fn<(path: string) => Promise<Buffer>>()
    .mockResolvedValue(Buffer.from("PDF-CONTENT"));

  const attachmentSource: EmailAttachmentSource = { findMedia, readBytes };

  const service = new EmailService(
    makeAdapter(),
    logger,
    providerService,
    templateService,
    undefined,
    attachmentSource
  );

  // Replace the adapter-from-record factory so send() delegates to our mock.
  (service as unknown as { createAdapterFromRecord: unknown })[
    "createAdapterFromRecord"
  ] = () => providerAdapter;

  return { service, adapterSend, findMedia, readBytes };
}

describe("EmailService.send with attachments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves mediaId and forwards ResolvedAttachment[] to the provider adapter", async () => {
    const { service, adapterSend } = buildSend();
    const result = await service.send({
      to: "user@example.com",
      subject: "Invoice",
      html: "<p>See attached.</p>",
      attachments: [{ mediaId: "med-1" }],
    });

    expect(result).toEqual({ success: true, messageId: "msg-1" });
    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("PDF-CONTENT"),
          },
        ],
      })
    );
  });

  it("does not pass `attachments` key when the caller omits the field", async () => {
    const { service, adapterSend } = buildSend();
    await service.send({
      to: "user@example.com",
      subject: "No attachments",
      html: "<p>hi</p>",
    });

    const call = adapterSend.mock.calls[0]?.[0];
    expect(call?.attachments).toBeUndefined();
  });

  it("fails the whole send when a mediaId is missing — adapter is not called", async () => {
    const { service, adapterSend, findMedia } = buildSend();
    findMedia.mockResolvedValueOnce(null);

    await expect(
      service.send({
        to: "user@example.com",
        subject: "x",
        html: "<p>x</p>",
        attachments: [{ mediaId: "gone" }],
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [{ code: "EMAIL_ATTACHMENT_MEDIA_NOT_FOUND" }],
      },
    });

    expect(adapterSend).not.toHaveBeenCalled();
  });

  it("fails the send when EmailService was constructed without an attachment source", async () => {
    const { service: _full } = buildSend();

    // Rebuild without attachmentSource.
    const adapterSend = vi.fn();
    const providerAdapter: EmailProviderAdapter = {
      send: adapterSend.mockResolvedValue({ success: true }),
    };
    const providerService = {
      getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
        id: "p",
        type: "resend",
        fromEmail: "a@b",
        fromName: null,
        configuration: { apiKey: "k" },
        isActive: true,
      }),
    } as unknown as EmailProviderService;
    const templateService = {} as unknown as EmailTemplateService;

    const bare = new EmailService(
      makeAdapter(),
      logger,
      providerService,
      templateService,
      undefined,
      undefined
    );
    (bare as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => providerAdapter;

    await expect(
      bare.send({
        to: "u@e.com",
        subject: "x",
        html: "<p>x</p>",
        attachments: [{ mediaId: "m1" }],
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: {
        emailAttachmentCode: "EMAIL_ATTACHMENT_STORAGE_READ_FAILED",
        reason: "no-attachment-source",
      },
    });
    expect(adapterSend).not.toHaveBeenCalled();
  });
});
