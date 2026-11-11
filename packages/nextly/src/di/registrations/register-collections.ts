/**
 * Collections domain DI registrations.
 *
 * Wires the three collection singletons:
 * - CollectionService — unified metadata + entry orchestrator. Its
 *   factory is the most complex in the system: it builds a file
 *   manager, dynamic-collection service, metadata service, relationship
 *   service, access control service, and entry service, then composes
 *   them.
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

import { resolve } from "node:path";

import type { SchemaRegistry } from "../../database/schema-registry";
import type { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { DynamicCollectionService } from "../../domains/dynamic-collections";
import { collectionMetadataFetcher } from "../../domains/dynamic-collections/services/collection-metadata-fetcher";
import { releaseVisibilityFor } from "../../domains/releases/release-visibility";
import { retentionPoliciesFrom } from "../../domains/retention/passes";
import type { BuilderSaveSetup } from "../../domains/schema/builder-save/collection-save";
import {
  CollectionFileManager,
  CollectionSchemaCache,
} from "../../services/collection-file-manager";
import { CollectionEntryService } from "../../services/collections/collection-entry-service";
import { CollectionMetadataService } from "../../services/collections/collection-metadata-service";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { CollectionRelationshipService } from "../../services/collections/collection-relationship-service";
import { CollectionService } from "../../services/collections/collection-service";
import { CollectionsHandler } from "../../services/collections-handler";
import type { FieldGroupDataService } from "../../services/field-groups";
import { DEFAULT_DB_CONFIG } from "../../shared/types/config";
import { container } from "../container";

import { contentWriteSeams } from "./content-write-seams";
import { createNoOpHookRegistry } from "./no-op-hook-registry";
import type { RegistrationContext } from "./types";

export function registerCollectionServices(ctx: RegistrationContext): void {
  const {
    adapter,
    adapterDrizzleDb,
    logger,
    basePath,
    schemasDir,
    migrationsDir,
    hookRegistry,
  } = ctx;

  // CollectionService composes file manager, dynamic-collection,
  // metadata, relationship, access control, and entry services.
  // Read by every service that saves a collection, the `CollectionsHandler`
  // included, which builds its own.
  container.registerSingleton<BuilderSaveSetup>("builderSaveSetup", () =>
    builderSaveSetup(ctx)
  );

  // One runtime-table cache for the process, read by the collection service's file manager and
  // the content handler's alike: a drop or refresh through either reaches both readers.
  container.registerSingleton<CollectionSchemaCache>(
    "collectionSchemaCache",
    () => {
      const cache = new CollectionSchemaCache();
      // A table rebuilt because another instance changed it replaces the adapter's copy too, so
      // the adapter's reads and writes by table name use its new columns. Looked up when it is
      // needed: the schema registry is registered after these services.
      cache.setRebuiltTableListener((tableName, table) => {
        if (container.has("schemaRegistry")) {
          container
            .get<SchemaRegistry>("schemaRegistry")
            .refreshDynamicTable(tableName, table);
        }
      });
      return cache;
    }
  );

  container.registerSingleton<CollectionService>("collectionService", () => {
    // Raw Drizzle instance for non-BaseService classes that need it directly.
    const drizzleDb = adapterDrizzleDb;

    const fileManager = new CollectionFileManager(
      drizzleDb,
      {
        schemasDir: schemasDir ?? `${basePath}/src/db/schemas/dynamic`,
        migrationsDir: migrationsDir ?? `${basePath}/src/db/migrations/dynamic`,
      },
      container.get<CollectionSchemaCache>("collectionSchemaCache")
    );

    // Runtime schema generation: UI-created collections work without
    // pre-compiled TypeScript schemas.
    fileManager.setAdapter(adapter);
    // Read through the registry row cache outside a transaction (`collectionMetadataFetcher`).
    fileManager.setMetadataFetcher(collectionMetadataFetcher(adapter, logger));

    const dynamicCollectionService = new DynamicCollectionService(
      adapter,
      logger,
      // i18n: the site's languages, read as they are now: the default locale seeds/restores the
      // companion on a localization toggle, and whether localization is configured follows the
      // list rather than the container, whose registration order would otherwise decide it.
      ctx.languages
    );

    const metadataService = new CollectionMetadataService(
      adapter,
      logger,
      fileManager,
      dynamicCollectionService
    );
    // A Schema Builder save writes the app's definition file and migrations
    // folder, as `migrate:create` would, never the dynamic folder above.
    metadataService.setBuilderSave(
      container.get<BuilderSaveSetup>("builderSaveSetup")
    );

    // Wire PermissionSeedService so new/updated collections auto-seed
    // CRUD permissions.
    if (container.has("permissionSeedService")) {
      metadataService.setPermissionSeedService(
        container.get<PermissionSeedService>("permissionSeedService")
      );
    }

    // Create the relationship service and expose it via the DI container
    // so other services (e.g. FieldGroupDataService) can share the same
    // instance instead of creating duplicates.
    const relationshipService = new CollectionRelationshipService(
      adapter,
      logger,
      fileManager,
      dynamicCollectionService,
      releaseVisibilityFor(adapter)
    );
    if (!container.has("relationshipService")) {
      container.registerSingleton<CollectionRelationshipService>(
        "relationshipService",
        () => relationshipService
      );
    }

    const rbacAccessControlService = container.get<RBACAccessControlService>(
      "rbacAccessControlService"
    );

    // Component data service may be unavailable in very minimal boots.
    const fieldGroupDataService = container.has("fieldGroupDataService")
      ? container.get<FieldGroupDataService>("fieldGroupDataService")
      : undefined;

    const entryService = new CollectionEntryService(
      adapter,
      logger,
      fileManager,
      dynamicCollectionService,
      relationshipService,
      hookRegistry ?? createNoOpHookRegistry(),
      fieldGroupDataService,
      rbacAccessControlService,
      // i18n M4: forward normalized localization config so localized reads resolve
      // translatable fields from the companion table.
      ctx.languages,
      ...contentWriteSeams(ctx)
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
    const drizzleDb = adapterDrizzleDb;
    const policiesForHandler = retentionPoliciesFrom(ctx.config);
    const handler = new CollectionsHandler(
      adapter,
      drizzleDb,
      logger,
      basePath,
      // i18n M4: enable companion-aware reads on the dispatcher-facing handler.
      ctx.languages,
      // Content writes offer a retention pass, so the ledgers stay bounded in
      // installs that never run the drain. EVERY policy is passed: this handler
      // is the seam a dispatcher-driven install writes through, so one missing
      // here is a table that install never prunes — which is how the delivery
      // log came to be swept only by sends, and therefore never at all once an
      // install stopped sending.
      // DERIVED, not the raw fields. `retentionPoliciesFrom` resolves the
      // delivery-log default from the nested `email` block when nothing
      // flattened it, and a direct `registerServices()` caller using a
      // database-managed provider supplies no `email` block at all — so the raw
      // `emailRetention` is undefined there while every other registration on
      // the same config correctly gets the default window. Forwarding the raw
      // field made this handler see all three as absent and build no runner,
      // which is the tail sweep going missing on exactly the dispatcher-driven
      // path this argument list exists to reach.
      policiesForHandler.webhookPolicy ?? undefined,
      policiesForHandler.auditPolicy,
      policiesForHandler.emailPolicy
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

/**
 * Where the app's Schema Builder saves write, and with which config: the
 * config's definition file and migrations folder, under the app's directory,
 * the folder `nextly migrate` and `migrate:create` use.
 */
function builderSaveSetup(ctx: RegistrationContext): BuilderSaveSetup {
  const { uiSchemaFile, migrationsDir } = ctx.config.db ?? DEFAULT_DB_CONFIG;
  const db = { uiSchemaFile, migrationsDir };
  return {
    config: {
      collections: ctx.config.collections ?? [],
      singles: ctx.config.singles ?? [],
      fieldGroups: ctx.config.fieldGroups ?? [],
      plugins: ctx.config.plugins ?? [],
      localization: ctx.config.localization,
      db,
    },
    ...(ctx.deferredExtends === undefined
      ? {}
      : { deferredExtends: ctx.deferredExtends }),
    projectRoot: ctx.basePath,
    migrationsDir: resolve(ctx.basePath, db.migrationsDir),
  };
}
