/**
 * Singles domain DI registrations.
 *
 * Registers the two single-document services:
 * - SingleRegistryService — registry for code-first and UI-defined
 *   Singles. Wired with PermissionSeedService when available so
 *   newly-registered singles auto-seed CRUD permissions.
 * - SingleEntryService — CRUD over the generated single tables.
 *   Depends on the registry, the component data service, the
 *   unified RBAC access control service, and a hook registry.
 */

import type { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import type { WebhookFastDrainScheduler } from "../../domains/webhooks/after-drain";
import { MetaRetentionGate } from "../../domains/webhooks/retention-gate";
import { WebhookRetentionRunner } from "../../domains/webhooks/retention-runner";
import type { ComponentDataService } from "../../services/components";
import { container } from "../container";

import { createNoOpHookRegistry } from "./no-op-hook-registry";
import type { RegistrationContext } from "./types";

export function registerSingleServices(ctx: RegistrationContext): void {
  const { adapter, logger, hookRegistry } = ctx;

  container.registerSingleton<SingleRegistryService>(
    "singleRegistryService",
    () => {
      const singleRegistryService = new SingleRegistryService(adapter, logger);

      if (container.has("permissionSeedService")) {
        singleRegistryService.setPermissionSeedService(
          container.get<PermissionSeedService>("permissionSeedService")
        );
      }

      return singleRegistryService;
    }
  );

  container.registerSingleton<SingleEntryService>("singleEntryService", () => {
    const singleRegistryService = container.get<SingleRegistryService>(
      "singleRegistryService"
    );

    const componentDataService = container.get<ComponentDataService>(
      "componentDataService"
    );

    const rbacAccessControlService = container.get<RBACAccessControlService>(
      "rbacAccessControlService"
    );

    return new SingleEntryService(
      adapter,
      logger,
      singleRegistryService,
      hookRegistry ?? createNoOpHookRegistry(),
      componentDataService,
      rbacAccessControlService,
      // i18n: forward the normalized localization config so localized singles resolve
      // and write translatable fields via their companion table (mirrors collections).
      ctx.config.localization,
      // The single write path appends outbox events through this service, so it
      // gets its own retention runner (the handler's is not on this path),
      // matching the collection write path.
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
