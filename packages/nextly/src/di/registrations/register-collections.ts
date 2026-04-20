/**
 * Collections domain DI registrations.
 *
 * Wires the three collection singletons:
 * - CollectionService — unified metadata + entry orchestrator. Its
 *   factory is the most complex in the system: it builds a file
 *   manager, dynamic-collection service, metadata service, relationship
 *   service, field permission checker, access control service, and
 *   entry service, then composes them.
 * - CollectionsHandler — thin dispatcher-facing handler that needs a
 *   raw Drizzle instance for legacy query paths.
 * - CollectionRegistryService — tracks registered collections and
 *   owns permission seeding when `syncCodeFirstCollections()` runs.
 *
 * The sync logic that consumes these services (auto-creating tables for
 * code-first collections/components and wiring per-collection RBAC
 * access rules) stays in `register.ts` because it runs after every
 * domain is registered.
 */

import { DynamicCollectionService } from "../../domains/dynamic-collections";
import { AccessControlService } from "../../services/access";
import { FieldPermissionCheckerService } from "../../services/auth/field-permission-checker-service";
import type { PermissionSeedService } from "../../services/auth/permission-seed-service";
import type { RBACAccessControlService } from "../../services/auth/rbac-access-control-service";
import { CollectionFileManager } from "../../services/collection-file-manager";
import { CollectionEntryService } from "../../services/collections/collection-entry-service";
import { CollectionMetadataService } from "../../services/collections/collection-metadata-service";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { CollectionRelationshipService } from "../../services/collections/collection-relationship-service";
import { CollectionService } from "../../services/collections/collection-service";
import { CollectionsHandler } from "../../services/collections-handler";
import type { ComponentDataService } from "../../services/components";
import { container } from "../container";

import { createNoOpHookRegistry } from "./no-op-hook-registry";
import type { RegistrationContext } from "./types";

export function registerCollectionServices(ctx: RegistrationContext): void {
  const {
    adapter,
    adapterDrizzleDb,
    db,
    logger,
    basePath,
    schemasDir,
    migrationsDir,
    hookRegistry,
  } = ctx;

  // CollectionService — composes file manager, dynamic-collection,
  // metadata, relationship, field-permission, access control, and
  // entry services.
  container.registerSingleton<CollectionService>("collectionService", () => {
    // Raw Drizzle instance for non-BaseService classes that need it directly.
    const drizzleDb = db ?? adapterDrizzleDb;

    const fileManager = new CollectionFileManager(drizzleDb, {
      schemasDir: schemasDir ?? `${basePath}/src/db/schemas/dynamic`,
      migrationsDir: migrationsDir ?? `${basePath}/src/db/migrations/dynamic`,
    });

    // Runtime schema generation: UI-created collections work without
    // pre-compiled TypeScript schemas.
    fileManager.setAdapter(adapter);
    fileManager.setMetadataFetcher(async (collectionName: string) => {
      try {
        const result = await adapter.selectOne<{
          fields: string;
          table_name: string;
        }>("dynamic_collections", {
          where: {
            and: [{ column: "slug", op: "=", value: collectionName }],
          },
        });

        if (result) {
          const fields =
            typeof result.fields === "string"
              ? JSON.parse(result.fields)
              : result.fields;
          return {
            fields,
            tableName: result.table_name,
          };
        }
      } catch (error) {
        console.error(
          "[registerCollectionServices] Failed to fetch collection metadata:",
          error
        );
      }
      return null;
    });

    const dynamicCollectionService = new DynamicCollectionService(
      adapter,
      logger
    );

    const metadataService = new CollectionMetadataService(
      adapter,
      logger,
      fileManager,
      dynamicCollectionService
    );

    // Wire PermissionSeedService so new/updated collections auto-seed
    // CRUD permissions.
    if (container.has("permissionSeedService")) {
      metadataService.setPermissionSeedService(
        container.get<PermissionSeedService>("permissionSeedService")
      );
    }

    const fieldPermissionChecker = new FieldPermissionCheckerService(
      adapter,
      logger
    );

    // Create the relationship service and expose it via the DI container
    // so other services (e.g. ComponentDataService) can share the same
    // instance instead of creating duplicates.
    const relationshipService = new CollectionRelationshipService(
      adapter,
      logger,
      fileManager,
      dynamicCollectionService
    );
    if (!container.has("relationshipService")) {
      container.registerSingleton<CollectionRelationshipService>(
        "relationshipService",
        () => relationshipService
      );
    }

    // UI-stored access rules (separate from the RBAC service).
    const accessControlService = new AccessControlService();

    const rbacAccessControlService = container.get<RBACAccessControlService>(
      "rbacAccessControlService"
    );

    // Component data service may be unavailable in very minimal boots.
    const componentDataService = container.has("componentDataService")
      ? container.get<ComponentDataService>("componentDataService")
      : undefined;

    const entryService = new CollectionEntryService(
      adapter,
      logger,
      fileManager,
      dynamicCollectionService,
      relationshipService,
      fieldPermissionChecker,
      hookRegistry ?? createNoOpHookRegistry(),
      accessControlService,
      componentDataService,
      rbacAccessControlService
    );

    return new CollectionService(
      adapter,
      logger,
      metadataService,
      entryService
    );
  });

  // CollectionsHandler — dispatcher-facing handler with legacy Drizzle
  // access. Wires PermissionSeedService so createCollection() auto-seeds
  // CRUD permissions for newly created collections.
  container.registerSingleton<CollectionsHandler>("collectionsHandler", () => {
    const drizzleDb = db ?? adapterDrizzleDb;
    const handler = new CollectionsHandler(
      adapter,
      drizzleDb,
      logger,
      basePath
    );

    if (container.has("permissionSeedService")) {
      handler.setPermissionSeedService(
        container.get<PermissionSeedService>("permissionSeedService")
      );
    }

    return handler;
  });

  // CollectionRegistryService — also wires PermissionSeedService so
  // code-first syncs auto-seed permissions.
  container.registerSingleton<CollectionRegistryService>(
    "collectionRegistryService",
    () => {
      const collectionRegistryService = new CollectionRegistryService(
        adapter,
        logger
      );

      if (container.has("permissionSeedService")) {
        collectionRegistryService.setPermissionSeedService(
          container.get<PermissionSeedService>("permissionSeedService")
        );
      }

      return collectionRegistryService;
    }
  );
}
