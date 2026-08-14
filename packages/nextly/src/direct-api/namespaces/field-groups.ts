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
import { resolveComponentTableName } from "../../domains/schema/utils/resolve-table-name";
import { NextlyError } from "../../errors/nextly-error";
import { assertValidFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
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
      const result = await ctx.fieldGroupRegistryService.listComponents({
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
        const component =
          await ctx.fieldGroupRegistryService.getComponentBySlug(args.slug);

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

      // Through the service that owns the table and the row together. Writing the row here
      // directly is what made this path answer success for a field group whose comp_ table was
      // never created, leaving the registry describing storage that did not exist.
      const { record, migrationStatus } =
        await ctx.fieldGroupMetadataService.createFieldGroup({
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
        });

      return {
        message:
          migrationStatus === "applied"
            ? "Field group created."
            : "Field group created, but its table could not be provisioned. The field group is recorded with a failed migration and holds its slug, so creating it again is refused as a duplicate: check the server logs, then delete this field group before creating it again.",
        item: mapFieldGroupRecord(record),
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

      let validatedFields: FieldConfig[] | undefined;

      if (args.data.fields !== undefined) {
        const fieldsTyped = args.data.fields as unknown as FieldConfig[];
        // The same validator `create` uses, so a field group can always submit
        // its own unchanged fields back. The manifest schema is stricter in
        // ways that are legal here — a camelCase field name, an empty nested
        // group mid-scaffold — so validating an update against it would make
        // some groups creatable and then unupdatable.
        assertValidFieldGroupConfig({
          slug: args.slug,
          label:
            typeof args.data.label === "string"
              ? { singular: args.data.label }
              : { singular: args.slug },
          fields: fieldsTyped,
        });
        validatedFields = fieldsTyped;
      }

      // 🔴 Through the metadata service, not the registry. Writing the registry directly is what
      // made this transport store a new field set and a matching `schema_hash` while running no
      // DDL at all — the table kept its old columns and only the dispatcher's copy of this
      // operation ever moved them. The service owns both halves, so all three transports now do
      // the same thing.
      const { record } = await ctx.fieldGroupMetadataService.updateFieldGroup({
        slug: args.slug,
        label: args.data.label,
        description: args.data.description,
        admin: args.data.admin,
        fields: validatedFields as unknown as FieldDefinition[] | undefined,
        localized: args.data.localized,
        source: "ui",
      });

      return {
        message: "Field group updated.",
        item: mapFieldGroupRecord(record),
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

      await ctx.fieldGroupRegistryService.deleteComponent(args.slug);
      // the deleted slug rather than `id` because components are addressed
      // by slug throughout this namespace.
      return {
        message: "Field group deleted.",
        item: { slug: args.slug },
      };
    },
  };
}
