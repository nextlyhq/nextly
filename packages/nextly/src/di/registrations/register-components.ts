/**
 * Component domain DI registrations.
 *
 * Registered early in the orchestrator because `CollectionService` depends
 * on `FieldGroupDataService` (via `container.has` / `container.get` at factory
 * resolution time) for component-field read/write support.
 */

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
