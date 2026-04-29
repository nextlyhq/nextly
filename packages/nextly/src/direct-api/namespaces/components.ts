/**
 * Direct API Components Namespace
 *
 * Factory for the `nextly.components.*` sub-namespace. Manages component
 * *definitions* (metadata + field schemas). Component *instance* data is
 * automatically populated when reading collection/single entries.
 *
 * @packageDocumentation
 */

import { NextlyError } from "../../errors/nextly-error";
import type {
  ComponentDefinition,
  ComponentListResult,
  CreateComponentArgs,
  DeleteComponentArgs,
  DeleteResult,
  FindComponentBySlugArgs,
  FindComponentsArgs,
  UpdateComponentArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import { isNotFoundError, mapComponentRecord, mergeConfig } from "./helpers";

/**
 * Components namespace API, bound to a Nextly context.
 */
export interface ComponentsNamespace {
  find(args?: FindComponentsArgs): Promise<ComponentListResult>;
  findBySlug(
    args: FindComponentBySlugArgs
  ): Promise<ComponentDefinition | null>;
  create(args: CreateComponentArgs): Promise<ComponentDefinition>;
  update(args: UpdateComponentArgs): Promise<ComponentDefinition>;
  delete(args: DeleteComponentArgs): Promise<DeleteResult>;
}

/**
 * Build the `components` namespace for a `Nextly` instance.
 */
export function createComponentsNamespace(
  ctx: NextlyContext
): ComponentsNamespace {
  return {
    async find(args: FindComponentsArgs = {}): Promise<ComponentListResult> {
      const result = await ctx.componentRegistryService.listComponents({
        source: args.source,
        migrationStatus: args.migrationStatus,
        locked: args.locked,
        search: args.search,
        limit: args.limit,
        offset: args.offset,
      });

      return {
        docs: result.data.map(mapComponentRecord),
        totalDocs: result.total,
        limit: args.limit ?? result.data.length,
        offset: args.offset ?? 0,
      };
    },

    async findBySlug(
      args: FindComponentBySlugArgs
    ): Promise<ComponentDefinition | null> {
      const config = mergeConfig(ctx.defaultConfig, args);

      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for components.findBySlug()",
          statusCode: 400,
        });
      }

      try {
        const component = await ctx.componentRegistryService.getComponentBySlug(
          args.slug
        );

        if (!component) {
          if (config.disableErrors) {
            return null;
          }
          throw NextlyError.notFound({
            logContext: { slug: args.slug, entity: "component" },
          });
        }

        return mapComponentRecord(component);
      } catch (error) {
        if (error instanceof NextlyError) {
          throw error;
        }
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async create(args: CreateComponentArgs): Promise<ComponentDefinition> {
      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for components.create()",
          statusCode: 400,
        });
      }

      if (!args.label) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'label' is required for components.create()",
          statusCode: 400,
        });
      }

      if (!args.fields || !Array.isArray(args.fields)) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'fields' array is required for components.create()",
          statusCode: 400,
        });
      }

      const { calculateSchemaHash } = await import(
        "../../services/schema/schema-hash"
      );
      const fieldsTyped =
        args.fields as unknown as import("../../collections/fields/types").FieldConfig[];
      const schemaHash = calculateSchemaHash(fieldsTyped);

      const component = await ctx.componentRegistryService.registerComponent({
        slug: args.slug,
        label: args.label,
        tableName: args.tableName ?? `comp_${args.slug}`,
        description: args.description,
        fields: fieldsTyped,
        admin: args.admin,
        source: "ui",
        locked: false,
        schemaHash,
        schemaVersion: 1,
        migrationStatus: "pending",
      });

      return mapComponentRecord(component);
    },

    async update(args: UpdateComponentArgs): Promise<ComponentDefinition> {
      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for components.update()",
          statusCode: 400,
        });
      }

      if (!args.data || typeof args.data !== "object") {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'data' object is required for components.update()",
          statusCode: 400,
        });
      }

      const updateData: Record<string, unknown> = {};

      if (args.data.label !== undefined) {
        updateData.label = args.data.label;
      }

      if (args.data.description !== undefined) {
        updateData.description = args.data.description;
      }

      if (args.data.fields !== undefined) {
        const fieldsTyped = args.data
          .fields as unknown as import("../../collections/fields/types").FieldConfig[];
        updateData.fields = fieldsTyped;
        const { calculateSchemaHash } = await import(
          "../../services/schema/schema-hash"
        );
        updateData.schemaHash = calculateSchemaHash(fieldsTyped);
      }

      if (args.data.admin !== undefined) {
        updateData.admin = args.data.admin;
      }

      const component = await ctx.componentRegistryService.updateComponent(
        args.slug,
        updateData,
        { source: "ui" }
      );

      return mapComponentRecord(component);
    },

    async delete(args: DeleteComponentArgs): Promise<DeleteResult> {
      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for components.delete()",
          statusCode: 400,
        });
      }

      await ctx.componentRegistryService.deleteComponent(args.slug);
      return {
        deleted: true,
        ids: [args.slug],
      };
    },
  };
}
