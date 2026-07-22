/**
 * Register every known component's runtime schema so the ORM can address its `comp_` table.
 *
 * `adapter.select`/`delete` resolve a table through the SchemaRegistry. The app registers
 * component schemas during boot, but CLI entry points build a registry from the STATIC
 * system tables only, so `comp_` tables are unaddressable there. Any CLI operation that
 * has to read or write component rows must call this first.
 *
 * Reads the component list from `dynamic_components`, so it reflects whatever the database
 * actually holds rather than the config — which is what an orphan cleanup needs.
 *
 * @module domains/components/services/register-component-schemas
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { SchemaRegistry } from "../../../database/schema-registry";
import type { Logger } from "../../../shared/types";
import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";

import { ComponentRegistryService } from "./component-registry-service";
import { ComponentSchemaService } from "./component-schema-service";

export interface RegisterComponentSchemasArgs {
  adapter: DrizzleAdapter;
  registry: SchemaRegistry;
  dialect: SupportedDialect;
  logger: Logger;
}

/**
 * Registers a runtime schema for every component in `dynamic_components`, plus the
 * `comp_<slug>_locales` companion for localized ones.
 *
 * @returns the number of component tables registered.
 */
export async function registerComponentSchemas(
  args: RegisterComponentSchemasArgs
): Promise<number> {
  const { adapter, registry, dialect, logger } = args;

  const componentRegistry = new ComponentRegistryService(adapter, logger);
  const schemaService = new ComponentSchemaService(dialect);

  const components = await componentRegistry.getAllComponents();

  for (const component of components) {
    const localized = component.localized === true;
    const fields = component.fields ?? [];

    registry.registerDynamicSchema(
      component.tableName,
      schemaService.generateRuntimeSchema(component.tableName, fields, {
        localized,
      })
    );

    if (localized) {
      const companion = buildCompanionRuntimeTable({
        slug: component.slug,
        tableName: component.tableName,
        fields: fields as { name: string; type: string }[],
        dialect,
        localized: true,
        status: false,
      });
      if (companion) {
        registry.registerDynamicSchema(
          companion.companionTableName,
          companion.table
        );
      }
    }
  }

  logger.debug("Component schemas registered", { count: components.length });
  return components.length;
}
