/**
 * Direct API Field Groups Namespace
 *
 * Factory for the `nextly.fieldGroups.*` sub-namespace. Manages field group
 * *definitions* (metadata + field schemas). Field group *instance* data is
 * automatically populated when reading collection/single entries.
 *
 * @packageDocumentation
 */

import type { FieldConfig } from "../../collections/fields/types";
import { assertValidFieldGroupConfig } from "../../components/config/validate-field-group";
import { resolveComponentTableName } from "../../domains/schema/utils/resolve-table-name";
import { NextlyError } from "../../errors/nextly-error";
import type {
  FieldGroupDefinition,
  CreateFieldGroupArgs,
  DeleteFieldGroupArgs,
  FindFieldGroupBySlugArgs,
  FindFieldGroupsArgs,
  ListResult,
  MutationResult,
  UpdateFieldGroupArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import { isNotFoundError, mapFieldGroupRecord, mergeConfig } from "./helpers";

/**
 * Field groups namespace API, bound to a Nextly context.
 *
 * (`ListResult<T>`, `MutationResult<T>`).
 */
export interface FieldGroupsNamespace {
  find(args?: FindFieldGroupsArgs): Promise<ListResult<FieldGroupDefinition>>;
  findBySlug(
    args: FindFieldGroupBySlugArgs
  ): Promise<FieldGroupDefinition | null>;
  create(
    args: CreateFieldGroupArgs
  ): Promise<MutationResult<FieldGroupDefinition>>;
  update(
    args: UpdateFieldGroupArgs
  ): Promise<MutationResult<FieldGroupDefinition>>;
  delete(args: DeleteFieldGroupArgs): Promise<MutationResult<{ slug: string }>>;
}

/**
 * Build the `fieldGroups` namespace for a `Nextly` instance.
 */
export function createFieldGroupsNamespace(
  ctx: NextlyContext
): FieldGroupsNamespace {
  return {
    async find(
      args: FindFieldGroupsArgs = {}
    ): Promise<ListResult<FieldGroupDefinition>> {
      const result = await ctx.componentRegistryService.listComponents({
        source: args.source,
        migrationStatus: args.migrationStatus,
        locked: args.locked,
        search: args.search,
        limit: args.limit,
        offset: args.offset,
      });

      // service pagination; map it onto canonical page-based meta. We
      // synthesize `page` from `(offset / limit) + 1` so callers see the
      // same `{ items, meta }` envelope as page-paginated namespaces.
      const limit = args.limit ?? result.data.length;
      const offset = args.offset ?? 0;
      const total = result.total;
      const effectiveLimit = limit > 0 ? limit : Math.max(total, 1);
      const totalPages = Math.max(1, Math.ceil(total / effectiveLimit));
      const page = Math.floor(offset / effectiveLimit) + 1;
      return {
        items: result.data.map(mapFieldGroupRecord),
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    },

    async findBySlug(
      args: FindFieldGroupBySlugArgs
    ): Promise<FieldGroupDefinition | null> {
      const config = mergeConfig(ctx.defaultConfig, args);

      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for fieldGroups.findBySlug()",
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

        return mapFieldGroupRecord(component);
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

    async create(
      args: CreateFieldGroupArgs
    ): Promise<MutationResult<FieldGroupDefinition>> {
      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for fieldGroups.create()",
          statusCode: 400,
        });
      }

      if (!args.label) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'label' is required for fieldGroups.create()",
          statusCode: 400,
        });
      }

      if (!args.fields || !Array.isArray(args.fields)) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'fields' array is required for fieldGroups.create()",
          statusCode: 400,
        });
      }

      const { calculateSchemaHash } = await import(
        "../../domains/schema/services/schema-hash"
      );
      const fieldsTyped = args.fields as unknown as FieldConfig[];
      const schemaHash = calculateSchemaHash(fieldsTyped);

      // Canonical resolution: an explicit tableName is honored verbatim;
      // otherwise the slug is normalized before the comp_ prefix so a dashed
      // slug maps to the same table the schema layer creates. The explicit form
      // goes through the same reserved-storage rules as a code-first dbName,
      // because a name pointing at framework tables would let a later delete
      // drop storage this component does not own.
      // Validated for slug format and reserved names. Two slugs that collapse
      // to one table are caught by defineConfig for code-first components and
      // by the unique index on dynamic_components.table_name here.
      assertValidFieldGroupConfig({
        slug: args.slug,
        label: { singular: args.label },
        fields: fieldsTyped,
      });
      const tableName = resolveComponentTableName(args.slug);

      const component = await ctx.componentRegistryService.registerComponent({
        slug: args.slug,
        label: args.label,
        tableName,
        description: args.description,
        fields: fieldsTyped,
        admin: args.admin,
        source: "ui",
        locked: false,
        schemaHash,
        schemaVersion: 1,
        migrationStatus: "pending",
      });

      return {
        message: "Field group created.",
        item: mapFieldGroupRecord(component),
      };
    },

    async update(
      args: UpdateFieldGroupArgs
    ): Promise<MutationResult<FieldGroupDefinition>> {
      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for fieldGroups.update()",
          statusCode: 400,
        });
      }

      if (!args.data || typeof args.data !== "object") {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'data' object is required for fieldGroups.update()",
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
        const fieldsTyped = args.data.fields as unknown as FieldConfig[];
        updateData.fields = fieldsTyped;
        const { calculateSchemaHash } = await import(
          "../../domains/schema/services/schema-hash"
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

      return {
        message: "Field group updated.",
        item: mapFieldGroupRecord(component),
      };
    },

    async delete(
      args: DeleteFieldGroupArgs
    ): Promise<MutationResult<{ slug: string }>> {
      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for fieldGroups.delete()",
          statusCode: 400,
        });
      }

      await ctx.componentRegistryService.deleteComponent(args.slug);
      // the deleted slug rather than `id` because components are addressed
      // by slug throughout this namespace.
      return {
        message: "Field group deleted.",
        item: { slug: args.slug },
      };
    },
  };
}
