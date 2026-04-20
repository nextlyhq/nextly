/**
 * EmailService.sendWithTemplate — attachment merge integration.
 *
 * Verifies template-default attachments get resolved and merged with
 * per-send attachments before handoff to the provider adapter.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../shared/types";
import type { EmailProviderService } from "../services/email-provider-service";
import type { EmailAttachmentSource } from "../services/email-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import type { EmailProviderAdapter } from "../types";

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

function build(templateAttachments: EmailTemplateRecord["attachments"]) {
  const adapterSend = vi
    .fn<EmailProviderAdapter["send"]>()
    .mockResolvedValue({ success: true, messageId: "m-1" });
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

  const templateRecord = {
    id: "t-1",
    name: "Invoice",
    slug: "invoice",
    subject: "Invoice {{n}}",
    htmlContent: "<p>See attached.</p>",
    plainTextContent: null,
    variables: null,
    useLayout: false,
    isActive: true,
    providerId: null,
    attachments: templateAttachments,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies EmailTemplateRecord;

  const templateService = {
    getTemplateBySlug: vi.fn().mockResolvedValue(templateRecord),
    getLayout: vi.fn(),
  } as unknown as EmailTemplateService;

  const findMedia = vi.fn(async (id: string) => ({
    filename: `storage/${id}.pdf`,
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
  }));
  const readBytes = vi.fn(async (path: string) =>
    Buffer.from(`bytes:${path}`)
  );
  const attachmentSource: EmailAttachmentSource = { findMedia, readBytes };

  const service = new EmailService(
    makeAdapter(),
    logger,
    providerService,
    templateService,
    undefined,
    attachmentSource
  );
  (service as unknown as { createAdapterFromRecord: unknown })[
    "createAdapterFromRecord"
  ] = () => providerAdapter;

  return { service, adapterSend, findMedia };
}

describe("EmailService.sendWithTemplate — attachment merge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves template-default attachments when caller provides none", async () => {
    const { service, adapterSend } = build([{ mediaId: "template-pdf" }]);
    await service.sendWithTemplate("invoice", "u@e.com", { n: "1" });

    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: "template-pdf.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("bytes:storage/template-pdf.pdf"),
          },
        ],
      })
    );
  });

  it("merges template defaults with per-send attachments (dedupe by mediaId, call wins)", async () => {
    const { service, adapterSend } = build([
      { mediaId: "shared", filename: "template.pdf" },
      { mediaId: "t-only" },
    ]);
    await service.sendWithTemplate(
      "invoice",
      "u@e.com",
      { n: "1" },
      {
        attachments: [
          { mediaId: "shared", filename: "call-override.pdf" },
          { mediaId: "c-only" },
        ],
      }
    );

    const call = adapterSend.mock.calls[0]?.[0];
    expect(call?.attachments).toHaveLength(3);
    expect(call?.attachments?.map((a) => a.filename)).toEqual([
      // Per-send filename override wins for the shared mediaId
      "call-override.pdf",
      // Template-only attachment uses media's originalFilename
      "t-only.pdf",
      // Per-send-only attachment uses media's originalFilename
      "c-only.pdf",
    ]);
  });

  it("omits the attachments key when both sources are empty", async () => {
    const { service, adapterSend } = build(null);
    await service.sendWithTemplate("invoice", "u@e.com", { n: "1" });

    const call = adapterSend.mock.calls[0]?.[0];
    expect(call?.attachments).toBeUndefined();
  });
});

describe("EmailService.sendWithTemplate — code-first template attachments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves attachments returned by a code-first template fn", async () => {
    const adapterSend = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-cf" });
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

    // DB lookup returns null so sendWithTemplate falls through to
    // the code-first template.
    const templateService = {
      getTemplateBySlug: vi.fn().mockResolvedValue(null),
      getLayout: vi.fn(),
    } as unknown as EmailTemplateService;

    const findMedia = vi.fn(async (id: string) => ({
      filename: `storage/${id}.pdf`,
      originalFilename: `${id}.pdf`,
      mimeType: "application/pdf",
    }));
    const readBytes = vi.fn(async (path: string) =>
      Buffer.from(`bytes:${path}`)
    );
    const attachmentSource: EmailAttachmentSource = { findMedia, readBytes };

    const emailConfig = {
      from: "no-reply@test.local",
      providerConfig: {
        provider: "resend" as const,
        apiKey: "k",
      },
      templates: {
        welcome: () => ({
          subject: "Welcome!",
          html: "<p>hi</p>",
          attachments: [{ mediaId: "code-first-pdf" }],
        }),
      },
    };

    const service = new EmailService(
      makeAdapter(),
      logger,
      providerService,
      templateService,
      emailConfig,
      attachmentSource
    );
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => providerAdapter;

    await service.sendWithTemplate("welcome", "u@e.com", { userName: "Dev" });

    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: "code-first-pdf.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("bytes:storage/code-first-pdf.pdf"),
          },
        ],
      })
    );
  });
});
