/**
 * Component domain DI registrations.
 *
 * Registered early in the orchestrator because `CollectionService` depends
 * on `ComponentDataService` (via `container.has` / `container.get` at factory
 * resolution time) for component-field read/write support.
 */

import type { CollectionRelationshipService } from "../../services/collections/collection-relationship-service";
import {
  ComponentDataService,
  ComponentRegistryService,
  ComponentSchemaService,
} from "../../services/components";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerComponentServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  // ComponentRegistryService — registry for component definitions
  container.registerSingleton<ComponentRegistryService>(
    "componentRegistryService",
    () => new ComponentRegistryService(adapter, logger)
  );

  // ComponentSchemaService — utility for generating component table schemas.
  // Standalone utility class that only needs the dialect.
  container.registerSingleton<ComponentSchemaService>(
    "componentSchemaService",
    () => new ComponentSchemaService(adapter.getCapabilities().dialect)
  );

  // ComponentDataService — CRUD for component instance data.
  // Depends on ComponentRegistryService for component metadata lookups
  // and optionally on CollectionRelationshipService (registered later by
  // the CollectionService factory) for depth-controlled population.
  container.registerSingleton<ComponentDataService>(
    "componentDataService",
    () => {
      const registryService = container.get<ComponentRegistryService>(
        "componentRegistryService"
      );

      const relationshipService = container.has("relationshipService")
        ? container.get<CollectionRelationshipService>("relationshipService")
        : undefined;

      return new ComponentDataService(
        adapter,
        logger,
        registryService,
        relationshipService
      );
    }
  );
}
