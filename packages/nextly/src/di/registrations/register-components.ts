/**
 * Component domain DI registrations.
 *
 * Registered early in the orchestrator because `CollectionService` depends
 * on `FieldGroupDataService` (via `container.has` / `container.get` at factory
 * resolution time) for component-field read/write support.
 */

import { FieldGroupMetadataService } from "../../domains/field-groups/services/field-group-metadata-service";
import type { CollectionRelationshipService } from "../../services/collections/collection-relationship-service";
import {
  FieldGroupDataService,
  FieldGroupRegistryService,
  FieldGroupSchemaService,
} from "../../services/field-groups";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerComponentServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  // FieldGroupRegistryService — registry for component definitions
  container.registerSingleton<FieldGroupRegistryService>(
    "fieldGroupRegistryService",
    () => new FieldGroupRegistryService(adapter, logger)
  );

  // FieldGroupSchemaService — utility for generating component table schemas.
  // Standalone utility class that only needs the dialect.
  container.registerSingleton<FieldGroupSchemaService>(
    "fieldGroupSchemaService",
    () => new FieldGroupSchemaService(adapter.getCapabilities().dialect)
  );

  // FieldGroupMetadataService — schema changes for a field group, holding the table change and the
  // registry write together. Registered rather than built per request so one wrapper here governs
  // every caller: the migration lock has to enclose both halves, and a lock applied at one call
  // site leaves the others uncovered. That is the same reason the three create transports were
  // allowed to disagree about whether the table gets made at all.
  container.registerSingleton<FieldGroupMetadataService>(
    "fieldGroupMetadataService",
    () =>
      new FieldGroupMetadataService(
        container.get<FieldGroupRegistryService>("fieldGroupRegistryService"),
        logger,
        adapter
      )
  );

  // FieldGroupDataService — CRUD for component instance data.
  // Depends on FieldGroupRegistryService for component metadata lookups
  // and optionally on CollectionRelationshipService (registered later by
  // the CollectionService factory) for depth-controlled population.
  container.registerSingleton<FieldGroupDataService>(
    "fieldGroupDataService",
    () => {
      const registryService = container.get<FieldGroupRegistryService>(
        "fieldGroupRegistryService"
      );

      const relationshipService = container.has("relationshipService")
        ? container.get<CollectionRelationshipService>("relationshipService")
        : undefined;

      return new FieldGroupDataService(
        adapter,
        logger,
        registryService,
        relationshipService,
        // i18n: forward the normalized localization config so a localized embedded
        // component resolves/writes translatable fields via its companion per language.
        ctx.config.localization
      );
    }
  );
}
