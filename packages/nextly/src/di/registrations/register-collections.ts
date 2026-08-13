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

import type { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { DynamicCollectionService } from "../../domains/dynamic-collections";
import { MetaRetentionGate } from "../../domains/retention/gate";
import {
  buildRetentionRunner,
  retentionPoliciesFrom,
} from "../../domains/retention/passes";
import type { WebhookFastDrainScheduler } from "../../domains/webhooks/after-drain";
import type { CacheRevalidator } from "../../revalidation/types";
import { AccessControlService } from "../../services/access";
import { CollectionFileManager } from "../../services/collection-file-manager";
import { CollectionEntryService } from "../../services/collections/collection-entry-service";
import { CollectionMetadataService } from "../../services/collections/collection-metadata-service";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { CollectionRelationshipService } from "../../services/collections/collection-relationship-service";
import { CollectionService } from "../../services/collections/collection-service";
import { CollectionsHandler } from "../../services/collections-handler";
import type { FieldGroupDataService } from "../../services/field-groups";
import { container } from "../container";

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
  container.registerSingleton<CollectionService>("collectionService", () => {
    // Raw Drizzle instance for non-BaseService classes that need it directly.
    const drizzleDb = adapterDrizzleDb;

    const fileManager = new CollectionFileManager(drizzleDb, {
      schemasDir: schemasDir ?? `${basePath}/src/db/schemas/dynamic`,
      migrationsDir: migrationsDir ?? `${basePath}/src/db/migrations/dynamic`,
    });

    // Runtime schema generation: UI-created collections work without
    // pre-compiled TypeScript schemas.
    fileManager.setAdapter(adapter);
    fileManager.setMetadataFetcher(
      async (collectionName: string, executor?: unknown) => {
        try {
          // Runs on the caller's transaction connection when supplied so an
          // uncached runtime-schema load inside a transaction stays on it.
          const result = await adapter.selectOne<{
            fields: string;
            tableName: string;
            status: boolean | number | null;
            localized: boolean | number | null;
          }>(
            "dynamic_collections",
            {
              where: {
                and: [{ column: "slug", op: "=", value: collectionName }],
              },
            },
            executor
          );

          if (result) {
            const fields =
              typeof result.fields === "string"
                ? JSON.parse(result.fields)
                : result.fields;
            return {
              fields,
              tableName: result.tableName,
              // SQLite returns 0/1 for booleans; PG/MySQL return real booleans.
              status: result.status === true || result.status === 1,
              // i18n M4: forward the localized flag so loadCompanionSchema can
              // build the companion table for localized reads.
              localized: result.localized === true || result.localized === 1,
            };
          }
        } catch (error) {
          console.error(
            "[registerCollectionServices] Failed to fetch collection metadata:",
            error
          );
        }
        return null;
      }
    );

    const dynamicCollectionService = new DynamicCollectionService(
      adapter,
      logger,
      // i18n: the default locale seeds/restores the companion on a localization toggle.
      ctx.config.localization?.defaultLocale,
      // The config being registered right now is the authority for this
      // service; reading it back out of the container would depend on the
      // registration order within this same function.
      ctx.config.localization != null
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

    // Create the relationship service and expose it via the DI container
    // so other services (e.g. FieldGroupDataService) can share the same
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
      accessControlService,
      fieldGroupDataService,
      rbacAccessControlService,
      // i18n M4: forward normalized localization config so localized reads resolve
      // translatable fields from the companion table.
      ctx.config.localization,
      // CollectionService writes append events through this same service, so it
      // needs its own runner — the handler's is not on this path.
      buildRetentionRunner({
        adapter,
        ...retentionPoliciesFrom(ctx.config),
        gate: new MetaRetentionGate(adapter),
        logger,
      }),
      // Shared post-response drain fast path (registered by the webhook
      // services). Absent only when webhooks were never registered.
      container.has("webhookFastDrainScheduler")
        ? container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler")
        : undefined,
      // Cache revalidator that flushes each write's revalidation intents
      // post-commit. Resolved lazily at flush time (not captured here) because
      // this service is constructed during boot, before a Next cache adapter
      // registers — an eager capture would memoize the no-op and ignore the
      // real adapter that registers later, at request time.
      () =>
        container.has("cacheRevalidator")
          ? container.get<CacheRevalidator>("cacheRevalidator")
          : undefined
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
      ctx.config.localization,
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
