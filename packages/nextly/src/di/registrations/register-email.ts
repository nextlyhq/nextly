/**
 * Email domain DI registrations.
 *
 * Registers the four email services (delivery, provider, template,
 * orchestration) so that both direct API callers and the dispatcher can
 * resolve them.
 */

import { EmailErrorCode } from "../../domains/email/errors";
import { activeEmailRetention } from "../../domains/email/retention-config";
import { getAttachmentLimits } from "../../domains/email/services/attachment-limits";
import { EmailDeliveryService } from "../../domains/email/services/email-delivery-service";
import type { EmailAttachmentSource } from "../../domains/email/services/email-service";
import { MetaRetentionGate } from "../../domains/retention/gate";
import {
  buildRetentionRunner,
  retentionPoliciesFrom,
} from "../../domains/retention/passes";
import { NextlyError } from "../../errors";
import { EmailProviderService } from "../../services/email/email-provider-service";
import { EmailService } from "../../services/email/email-service";
import { EmailTemplateService } from "../../services/email/email-template-service";
import type { MediaService as UnifiedMediaService } from "../../services/media/media-service";
import { SYSTEM_CONTEXT } from "../../shared/types";
import { isStorageReadTooLarge } from "../../storage/read-errors";
import {
  readStoredMediaBytes,
  StoredMediaUnreachableError,
} from "../../storage/read-stored-media";
import { container } from "../container";

import type { RegistrationContext } from "./types";

/**
 * A storage read failure, in the vocabulary the attachment path answers in.
 *
 * Named and exported rather than inlined in the reader, so the mapping can be
 * asserted without standing up the whole DI container. That is not tidiness:
 * this rule regressed silently once already — implementing `read` on the cloud
 * adapters moved attachments off a capped fetch and NOTHING failed — and the
 * reason nothing failed is that the rule lived in a closure inside a factory.
 *
 * An over-cap read becomes the SAME size error the URL-backed branch produces.
 * `attachment-resolver` passes through only `VALIDATION_ERROR` and wraps
 * everything else as an opaque storage failure, so an over-cap read arriving as
 * anything else tells the author their storage broke — when what happened is
 * that their attachment is too big and they can fix it by attaching something
 * smaller. Which branch read the bytes must not change which error they see.
 *
 * Everything else is returned UNCHANGED for the resolver to wrap, because a
 * timeout or a refused address says nothing an author can act on and its
 * message must not reach them.
 */
export function asAttachmentReadError(
  error: unknown,
  maxBytes: number
): unknown {
  if (error instanceof StoredMediaUnreachableError) {
    // Unchanged in what it reports: the URL route used to raise this inline,
    // and it is the storage read that failed rather than the attachment that
    // was too big.
    return NextlyError.internal({
      logContext: {
        emailAttachmentCode: EmailErrorCode.ATTACHMENT_STORAGE_READ_FAILED,
        url: error.url,
        status: error.status,
      },
    });
  }
  if (!isStorageReadTooLarge(error)) return error;
  return NextlyError.validation({
    errors: [
      {
        path: "attachments",
        code: EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED,
        message: "Attachment size exceeds the limit.",
      },
    ],
    logContext: {
      emailAttachmentCode: EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED,
      max: maxBytes,
    },
  });
}

export function registerEmailServices(ctx: RegistrationContext): void {
  const { adapter, logger, config, storage } = ctx;

  // EmailDeliveryService — the durable record of what was sent. Registered
  // first because the provider service resolves it for test sends.
  container.registerSingleton<EmailDeliveryService>(
    "emailDeliveryService",
    () =>
      new EmailDeliveryService(
        adapter,
        logger,
        // The sweep is offered by the SEND path rather than by a content write.
        // `email_deliveries` rows are created by sends, so sends are when the
        // table grows; a content write has no relationship to email volume, and
        // an install that never sends mail has nothing here to prune.
        //
        // `undefined` when no policy was carried through initialization, which
        // leaves the log unswept — a real outcome rather than a neutral default,
        // and the one this wiring exists to prevent.
        buildRetentionRunner({
          adapter,
          // The same derived list every other write path spreads. Scoping this
          // runner to email alone would make the send the one path that offers
          // some domains' passes and not others -- the asymmetry that left this
          // very table swept only by sends, and so never at all once an install
          // stopped sending.
          ...retentionPoliciesFrom(config),
          gate: new MetaRetentionGate(adapter),
          logger,
        }),
        // Derived from the SAME resolution the runner above spreads, not from
        // the flattened field alone. What is recorded and what is swept are two
        // halves of one policy, and reading them from different places is how
        // an install configuring `email.retention.maxAgeMs: 0` through the
        // public `registerServices()` API got a sweep that honoured it and a
        // writer that did not — inserting the recipient row it had just asked
        // never to store.
        //
        // Read per call, and through `activeEmailRetention`, so a window saved
        // during development governs recording as immediately as it governs
        // sweeping. A value captured here would leave the two disagreeing after
        // any hot reload.
        () => activeEmailRetention(retentionPoliciesFrom(config).emailPolicy)
      )
  );

  // EmailProviderService — CRUD for email provider configurations
  container.registerSingleton<EmailProviderService>(
    "emailProviderService",
    () =>
      new EmailProviderService(
        adapter,
        logger,
        // The Test button dispatches a real message, so it belongs in the
        // delivery log like any other send.
        container.get<EmailDeliveryService>("emailDeliveryService")
      )
  );

  // EmailTemplateService — CRUD for email templates
  container.registerSingleton<EmailTemplateService>(
    "emailTemplateService",
    () => new EmailTemplateService(adapter, logger, config.email?.appName)
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
    const deliveryService = container.get<EmailDeliveryService>(
      "emailDeliveryService"
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
          /*
           * ONE snapshot, because reading the policy twice let the two routes
           * enforce and report different caps: the environment backing it can
           * change between the calls, and nothing would have said so.
           */
          const limits = getAttachmentLimits();
          try {
            const bytes = await readStoredMediaBytes(
              storage,
              storagePath,
              limits.maxTotalBytes
            );
            // An attachment whose object is gone cannot be sent, and the author
            // is owed the same answer as any other failure to read it.
            if (bytes === null) {
              throw new StoredMediaUnreachableError(storagePath, 404);
            }
            return bytes;
          } catch (err) {
            throw asAttachmentReadError(err, limits.maxTotalBytes);
          }
        },
      };
    }

    return new EmailService(
      adapter,
      logger,
      providerService,
      templateService,
      config.email,
      attachmentSource,
      deliveryService
    );
  });
}
