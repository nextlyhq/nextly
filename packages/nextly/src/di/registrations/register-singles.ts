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
import { SingleMetadataService } from "../../domains/singles/services/single-metadata-service";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import type { FieldGroupDataService } from "../../services/field-groups";
import { container } from "../container";

import { contentWriteSeams } from "./content-write-seams";
import { createNoOpHookRegistry } from "./no-op-hook-registry";
import type { RegistrationContext } from "./types";

export function registerSingleServices(ctx: RegistrationContext): void {
  const { adapter, logger, hookRegistry } = ctx;

  container.registerSingleton<SingleRegistryService>(
    "singleRegistryService",
    () => {
      // The live code-first snapshot (for field `defaultValue` functions that do
      // not survive serialization) is set AFTER the boot metadata sync via
      // setCodeFirstSingles, not here — so a single whose sync fails never
      // exposes new fields paired with stale serialized metadata.
      const singleRegistryService = new SingleRegistryService(adapter, logger);

      if (container.has("permissionSeedService")) {
        singleRegistryService.setPermissionSeedService(
          container.get<PermissionSeedService>("permissionSeedService")
        );
      }

      return singleRegistryService;
    }
  );

  // Schema changes for a Single, holding the table change and the registry write together. It is
  // registered rather than built per request so a single wrapper here governs every caller: the
  // migration lock has to enclose both halves, and a lock applied at one call site leaves the
  // others uncovered.
  container.registerSingleton<SingleMetadataService>(
    "singleMetadataService",
    () =>
      new SingleMetadataService(
        container.get<SingleRegistryService>("singleRegistryService"),
        logger,
        adapter
      )
  );

  container.registerSingleton<SingleEntryService>("singleEntryService", () => {
    const singleRegistryService = container.get<SingleRegistryService>(
      "singleRegistryService"
    );

    const fieldGroupDataService = container.get<FieldGroupDataService>(
      "fieldGroupDataService"
    );

    const rbacAccessControlService = container.get<RBACAccessControlService>(
      "rbacAccessControlService"
    );

    return new SingleEntryService(
      adapter,
      logger,
      singleRegistryService,
      hookRegistry ?? createNoOpHookRegistry(),
      fieldGroupDataService,
      rbacAccessControlService,
      // i18n: forward the normalized localization config so localized singles resolve
      // and write translatable fields via their companion table (mirrors collections).
      ctx.languages,
      ...contentWriteSeams(ctx)
    );
  });
}
