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

import { MediaService as LegacyMediaService } from "../../services/media";
import { MediaService as UnifiedMediaService } from "../../services/media/media-service";
import { MediaFolderService } from "../../services/media-folder";
import type { IStorageAdapter } from "../../storage/adapters/base-adapter";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerMediaServices(ctx: RegistrationContext): void {
  const { adapter, logger, storage, mediaStorage, imageProcessor } = ctx;

  container.registerSingleton<UnifiedMediaService>("mediaService", () => {
    const legacyMediaService = new LegacyMediaService(adapter, logger);
    const folderService = new MediaFolderService(adapter, logger);

    // Late-binding getter so storage plugins registered after initial
    // service registration (e.g. in Next.js config reload) are still
    // visible to media operations.
    const storageGetter = (): IStorageAdapter | null => {
      if (storage) return storage;
      try {
        return mediaStorage.getDefaultAdapter();
      } catch {
        return null;
      }
    };

    return new UnifiedMediaService(
      legacyMediaService,
      folderService,
      storageGetter,
      imageProcessor,
      logger
    );
  });
}
