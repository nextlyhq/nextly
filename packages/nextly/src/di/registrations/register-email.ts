/**
 * Email domain DI registrations.
 *
 * Registers the three email services (provider, template, orchestration)
 * so that both direct API callers and the dispatcher can resolve them.
 */

import type { EmailAttachmentSource } from "../../domains/email/services/email-service";
import { EmailProviderService } from "../../services/email/email-provider-service";
import { EmailService } from "../../services/email/email-service";
import { EmailTemplateService } from "../../services/email/email-template-service";
import { MediaService as UnifiedMediaService } from "../../services/media/media-service";
import { SYSTEM_CONTEXT } from "../../shared/types";
import { safeFetch } from "../../utils/validate-external-url";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerEmailServices(ctx: RegistrationContext): void {
  const { adapter, logger, config, storage } = ctx;

  // EmailProviderService — CRUD for email provider configurations
  container.registerSingleton<EmailProviderService>(
    "emailProviderService",
    () => new EmailProviderService(adapter, logger)
  );

  // EmailTemplateService — CRUD for email templates
  container.registerSingleton<EmailTemplateService>(
    "emailTemplateService",
    () => new EmailTemplateService(adapter, logger)
  );

  // EmailService — orchestration layer for email sending. Depends on
  // EmailProviderService and EmailTemplateService. Optional EmailConfig
  // comes from `defineConfig({ email: { ... } })`. Optional attachment
  // source bridges MediaService + storage adapter for email attachments.
  container.registerSingleton<EmailService>("emailService", () => {
    const providerService = container.get<EmailProviderService>(
      "emailProviderService"
    );
    const templateService = container.get<EmailTemplateService>(
      "emailTemplateService"
    );

    // Build the attachment source when storage is available. The
    // readBytes function tries storage.read() first (local/S3 adapters),
    // then falls back to fetching the public URL (Vercel Blob / any
    // adapter that exposes getPublicUrl but not read). Without any
    // storage at all, attachment sends fail with STORAGE_READ_FAILED —
    // callers without attachments are unaffected.
    let attachmentSource: EmailAttachmentSource | undefined;
    if (storage) {
      attachmentSource = {
        findMedia: async mediaId => {
          try {
            const mediaService =
              container.get<UnifiedMediaService>("mediaService");
            const media = await mediaService.findById(mediaId, SYSTEM_CONTEXT);
            return {
              filename: media.filename,
              originalFilename: media.originalFilename,
              mimeType: media.mimeType,
            };
          } catch {
            return null;
          }
        },
        readBytes: async storagePath => {
          // 1. Try native read() (local disk, S3, etc.)
          if (typeof storage.read === "function") {
            const buffer = await storage.read(storagePath);
            if (buffer) return buffer;
          }
          // 2. Fallback: fetch via URL.
          //    Vercel Blob (and similar adapters) store the full public
          //    URL as the media filename, so storagePath may already be
          //    a URL. Only call getPublicUrl for relative paths.
          //    use safeFetch to reject URLs that
          //    resolve to private/loopback/link-local/cloud-metadata
          //    addresses — closes SSRF when an attacker controls the
          //    `storagePath` field.
          const url = storagePath.startsWith("http")
            ? storagePath
            : storage.getPublicUrl(storagePath);
          const response = await safeFetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch attachment from ${url}: HTTP ${response.status}`
            );
          }
          return Buffer.from(await response.arrayBuffer());
        },
      };
    }

    return new EmailService(
      adapter,
      logger,
      providerService,
      templateService,
      config.email,
      attachmentSource
    );
  });
}
