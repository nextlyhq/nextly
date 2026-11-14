/**
 * `sendWithTemplate` per-send `from`/`replyTo` must beat the template's own
 * overrides: the caller knows the concrete send context (a form rule's
 * sender, a reply-to resolved from a submission), while the template's
 * values are static defaults.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import type { EmailProviderService } from "../email-provider-service";
import { EmailService } from "../email-service";
import { renderTemplate } from "../render-template";
import type { EmailTemplateService } from "../email-template-service";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const adapter = {
  getDb: () => ({}),
  getCapabilities: () => ({ dialect: "postgresql" }),
} as unknown as DrizzleAdapter;

const dbTemplate = {
  slug: "form-notification",
  isActive: true,
  subject: "New submission",
  htmlContent: "<p>{{formName}}</p>",
  plainTextContent: null,
  preheader: null,
  useLayout: false,
  variables: [],
  attachments: null,
  providerId: null,
  fromOverride: "template@example.com",
  replyTo: "template-replies@example.com",
};

function buildService(template: Record<string, unknown> = dbTemplate) {
  const providerService = {
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue(null),
    getProviderDecrypted: vi.fn().mockResolvedValue(null),
  } as unknown as EmailProviderService;

  const templateService = {
    getTemplateBySlug: vi.fn().mockResolvedValue(template),
    // The send path asks which version to render; the stored row comes first.
    resolveForSend: vi.fn().mockResolvedValue({ template, preferCode: false }),
    // Sends render through the template service, as the real one does.
    renderStored: (
      template: Parameters<typeof renderTemplate>[0],
      data: Record<string, unknown>
    ) =>
      Promise.resolve(
        renderTemplate(template, null, data, { appName: "Nextly" })
      ),
  } as unknown as EmailTemplateService;

  const service = new EmailService(
    adapter,
    logger,
    providerService,
    templateService
  );

  // Only option plumbing is under test — the raw send is stubbed out.
  const send = vi
    .spyOn(service, "send")
    .mockResolvedValue({ success: true, messageId: "m1" });

  return { service, send };
}

describe("sendWithTemplate from/replyTo overrides", () => {
  it("prefers per-send from and replyTo over the template's overrides", async () => {
    const { service, send } = buildService();

    await service.sendWithTemplate(
      "form-notification",
      "to@example.com",
      { formName: "Contact" },
      { from: "rule@example.com", replyTo: "visitor@example.com" }
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "rule@example.com",
        replyTo: "visitor@example.com",
      })
    );
  });

  it("keeps the template's overrides when no per-send values are given", async () => {
    const { service, send } = buildService();

    await service.sendWithTemplate("form-notification", "to@example.com", {
      formName: "Contact",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "template@example.com",
        replyTo: "template-replies@example.com",
      })
    );
  });
});

describe("a test of the editor's draft", () => {
  const withAttachment = {
    ...dbTemplate,
    attachments: [{ mediaId: "stored", filename: "old.pdf" }],
  };

  it("sends the draft's attachments instead of the stored ones", async () => {
    const { service, send } = buildService(withAttachment);

    await service.sendTemplateTest(
      "form-notification",
      "me@example.com",
      {},
      {
        attachments: [{ mediaId: "added", filename: "new.pdf" }],
      }
    );

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      attachments: [{ mediaId: "added", filename: "new.pdf" }],
    });
  });

  it("sends none when the draft removed them", async () => {
    const { service, send } = buildService(withAttachment);

    await service.sendTemplateTest(
      "form-notification",
      "me@example.com",
      {},
      {
        attachments: null,
      }
    );

    expect(send.mock.calls[0]?.[0]).toMatchObject({ attachments: undefined });
  });
});
