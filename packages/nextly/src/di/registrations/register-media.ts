/**
 * Media domain DI registrations.
 *
 * Registers `UnifiedMediaService`, which composes the legacy
 * `MediaService` + `MediaFolderService` with the image processor and a
 * storage getter that resolves late-registered storage plugins.
 *
 * `MediaStorage` itself is initialized in the orchestrator (Layer 2.5)
 * and registered there so its setup happens before plugin init runs.
 */

import type { WebhookFastDrainScheduler } from "../../domains/webhooks/after-drain";
import { MetaRetentionGate } from "../../domains/webhooks/retention-gate";
import { WebhookRetentionRunner } from "../../domains/webhooks/retention-runner";
import { MediaService as LegacyMediaService } from "../../services/media";
import { MediaService as UnifiedMediaService } from "../../services/media/media-service";
import { MediaFolderService } from "../../services/media-folder";
import { UploadValidator } from "../../services/upload-validation";
import type { SecurityBlockLike } from "../../services/upload-validation";
import type { IStorageAdapter } from "../../storage/types";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerMediaServices(ctx: RegistrationContext): void {
  const { adapter, logger, storage, mediaStorage, imageProcessor } = ctx;

  container.registerSingleton<UnifiedMediaService>("mediaService", () => {
    const legacyMediaService = new LegacyMediaService(adapter, logger);
    const folderService = new MediaFolderService(adapter, logger);

    // Late-binding getter so storage plugins registered after initial
    // service registration (e.g. Next.js config reload) are still visible.
    const storageGetter = (): IStorageAdapter | null => {
      if (storage) return storage;
      try {
        return mediaStorage.getDefaultAdapter();
      } catch {
        return null;
      }
    };

    const config = container.has("config")
      ? container.get<{ security?: SecurityBlockLike }>("config")
      : undefined;
    const uploadValidator = new UploadValidator(config?.security);
    const svgCsp = config?.security?.uploads?.svgCsp ?? true;

    return new UnifiedMediaService(
      legacyMediaService,
      folderService,
      storageGetter,
      imageProcessor,
      uploadValidator,
      svgCsp,
      logger,
      // Media writes append outbox events through this service, so it carries
      // its own retention runner (the webhook handler's is not on this path),
      // mirroring collections and singles.
      ctx.config.webhookRetention
        ? new WebhookRetentionRunner({
            policy: ctx.config.webhookRetention,
            prune: { adapter, logger },
            gate: new MetaRetentionGate(adapter),
            logger,
          })
        : undefined,
      // Shared post-response drain fast path (registered by the webhook
      // services). Absent only when webhooks were never registered.
      container.has("webhookFastDrainScheduler")
        ? container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler")
        : undefined
    );
  });
}
