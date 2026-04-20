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

import { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import type { PermissionSeedService } from "../../services/auth/permission-seed-service";
import type { RBACAccessControlService } from "../../services/auth/rbac-access-control-service";
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
      rbacAccessControlService
    );
  });
}
