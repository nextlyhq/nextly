/**
 * CollectionMutationService — Write/mutation operations for collection entries.
 *
 * Extracted from CollectionEntryService (6,490-line god file) to handle all
 * create, update, and delete operations with hooks, validation, and relationships.
 *
 * Responsibilities:
 * - Create new entries with hooks, validation, relationships
 * - Update existing entries with hooks, validation
 * - Delete entries with hooks and cascading
 * - Transaction-aware variants of all CRUD operations
 * - Field uniqueness checking for stored hook validation
 * - Single-entry transaction helpers for batch operations
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";
import { eq, ne, and, like, ilike } from "drizzle-orm";

import type { BeforeOperationArgs, OperationType } from "@nextly/hooks/types";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { isComponentField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import { toSnakeCase } from "../../../lib/case-conversion";
import type { FieldPermissionCheckerService } from "../../../services/auth/field-permission-checker-service";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import { mapDbErrorToServiceError } from "../../../services/lib/db-error";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { DynamicCollectionService } from "../../dynamic-collections";

import type { CollectionAccessService } from "./collection-access-service";
import type {
  CollectionHookService,
  QueryDatabaseParams,
} from "./collection-hook-service";
import type { CollectionServiceResult, UserContext } from "./collection-types";
import {
  toCamelCase,
  isJsonFieldType,
  isRelationshipField,
  normalizeRelationshipValue,
  normalizeNestedRelationships,
  normalizeUploadFields,
  getTableName,
  generateSlug,
} from "./collection-utils";

export class CollectionMutationService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService,
    private readonly relationshipService: CollectionRelationshipService,
    private readonly fieldPermissionChecker: FieldPermissionCheckerService,
    private readonly accessService: CollectionAccessService,
    private readonly hookService: CollectionHookService,
    private readonly componentDataService?: ComponentDataService
  ) {
    super(adapter, logger);
  }

  /**
   * Wrapper around checkFieldUniqueness that matches the QueryDatabaseParams
   * signature expected by CollectionHookService.buildPrebuiltHookContext.
   */
  private readonly queryDatabaseFn = async (
    params: QueryDatabaseParams
  ): Promise<boolean> => {
    return this.checkFieldUniqueness(
      params.collection,
      params.field,
      params.value,
      params.caseInsensitive || false,
      params.excludeId
    );
  };

  // ============================================================
  // Field Uniqueness Check
  // ============================================================

  /**
   * Check if a field value already exists in a collection.
   *
   * Used by stored hooks for uniqueness validation. Can optionally exclude a specific document
   * (useful for update operations where we want to exclude the current document).
   *
   * @param collectionName - Name of the collection to query
   * @param field - Field name to check for uniqueness
   * @param value - Value to check for duplicates
   * @param caseInsensitive - Whether to perform case-insensitive comparison
   * @param excludeId - Optional document ID to exclude from the check (for updates)
   * @returns Promise<boolean> - true if a duplicate exists, false otherwise
   */
  async checkFieldUniqueness(
    collectionName: string,
    field: string,
    value: unknown,
    caseInsensitive: boolean = false,
    excludeId?: string
  ): Promise<boolean> {
    try {
      // Load the schema for this collection
      const schema = await this.fileManager.loadDynamicSchema(collectionName);

      // Check if the field exists in the schema
      if (!schema[field]) {
        this.logger.warn(
          `Field ${field} does not exist in collection ${collectionName}`
        );
        return false;
      }

      // Build the query
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (this.db as any).select().from(schema);

      // Build the WHERE condition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const conditions: any[] = [];

      // Add field value condition (case-sensitive or case-insensitive)
      if (caseInsensitive && typeof value === "string") {
        // Use ILIKE for PostgreSQL, LIKE for others (MySQL/SQLite are case-insensitive by default)
        const dialect = this.adapter?.dialect || "postgresql";
        if (dialect === "postgresql") {
          conditions.push(ilike(schema[field], value as string));
        } else {
          conditions.push(like(schema[field], value as string));
        }
      } else {
        // Case-sensitive comparison
        conditions.push(eq(schema[field], value));
      }

      // Exclude the current document ID if provided (for update operations)
      if (excludeId && schema.id) {
        conditions.push(ne(schema.id, excludeId));
      }

      // Apply all conditions
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      // Limit to 1 result since we only need to know if any match exists
      query = query.limit(1);

      // Execute the query
      const results = await query;

      // Return true if any matching document exists
      return results.length > 0;
    } catch (error: unknown) {
      this.logger.error(
        `Error checking field uniqueness for ${field} in ${collectionName}`,
        {
          error: error instanceof Error ? error.message : String(error),
          field,
          collectionName,
        }
      );
      // On error, return false to allow the operation to proceed
      // The actual validation error will be caught elsewhere
      return false;
    }
  }

  // ============================================================
  // Public CRUD Methods
  // ============================================================

  /**
   * Create a new entry.
   * Applies collection-level access control, field-level permissions, and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   * 2. Field-level permissions (FieldPermissionCheckerService)
   *
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @returns Created entry or error
   */
  async createEntry(
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      // Note: For create operations, we use the adapter directly with the table name,
      // so we don't need the Drizzle schema. The fields metadata from the collection
      // is sufficient for data processing (JSON serialization, date conversion, etc.)
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "create" as OperationType,
          args: { data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeCreate hooks (code-registered)
      // Hooks run before validation and can modify the incoming data
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: currentData,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeCreate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeCreate hooks (UI-configured)
      // Runs after code hooks, can further modify data
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Validate permissions if user provided and access not overridden
      if (accessUser?.id) {
        // Check field-level write permissions
        const fieldNames = Object.keys(finalData);
        for (const fieldName of fieldNames) {
          const canWrite = await this.fieldPermissionChecker.canAccessField(
            accessUser.id,
            params.collectionName,
            fieldName,
            "write"
          );

          if (!canWrite) {
            return {
              success: false,
              statusCode: 403,
              message: `You do not have permission to set the field "${fieldName}"`,
              data: null,
            };
          }
        }
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f => f.type === "relation" && f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      // Extract many-to-many data from finalData (after hooks)
      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name]; // Remove from main insert
        }
      });

      // Extract component field data (stored in separate comp_{slug} tables)
      // Component fields should not be stored in the collection table
      // Extract component field data for separate storage in comp_{slug} tables
      const componentFieldData: Record<string, unknown> = {};
      fields.forEach(field => {
        if (
          isComponentField(field as unknown as FieldConfig) &&
          finalData[field.name] !== undefined
        ) {
          componentFieldData[field.name] = finalData[field.name];
          delete finalData[field.name]; // Remove from main insert
        }
      });

      // Serialize hasMany relationship fields that store arrays as jsonb
      fields.forEach(field => {
        if (
          isRelationshipField(field.type) &&
          field.hasMany &&
          Array.isArray(finalData[field.name])
        ) {
          finalData[field.name] = JSON.stringify(finalData[field.name]);
        }
      });

      // Normalize relationship data inside repeater/group fields before serialization.
      // The admin panel may send full relationship objects ({id, title, slug, ...})
      // inside repeater rows — strip these down to just IDs to prevent bloated JSON.
      fields.forEach(field => {
        if (
          (field.type === "repeater" || field.type === "group") &&
          finalData[field.name] != null &&
          typeof finalData[field.name] === "object"
        ) {
          const nestedFields = (field.fields || []) as FieldDefinition[];
          if (
            nestedFields.some(
              f =>
                isRelationshipField(f.type) ||
                f.type === "repeater" ||
                f.type === "group"
            )
          ) {
            if (
              field.type === "repeater" &&
              Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = (finalData[field.name] as unknown[]).map(
                (row: unknown) =>
                  row && typeof row === "object" && !Array.isArray(row)
                    ? normalizeNestedRelationships(
                        row as Record<string, unknown>,
                        nestedFields
                      )
                    : row
              );
            } else if (
              field.type === "group" &&
              !Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = normalizeNestedRelationships(
                finalData[field.name] as Record<string, unknown>,
                nestedFields
              );
            }
          }
        }
      });

      // Serialize JSON fields (richtext, blocks, array, group, json)
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          finalData[field.name] != null
        ) {
          const value = finalData[field.name];
          // Only stringify if it's an object/array and not already a string
          if (typeof value === "object") {
            finalData[field.name] = JSON.stringify(value);
          } else if (typeof value === "string") {
            // Already a string - check if it's valid JSON to avoid double-serialization
            try {
              JSON.parse(value);
              // It's already valid JSON string, keep as-is
            } catch {
              // Not valid JSON string - this is unusual for JSON fields
              console.warn(
                `[createEntry] Field "${field.name}" (type: ${field.type}) is a string but not valid JSON`
              );
            }
          }
        }
      });

      // Convert date field strings to Date objects
      // This is necessary because Drizzle ORM expects Date objects for timestamp fields
      // (especially SQLite with mode: 'timestamp'), but the API receives ISO strings
      fields.forEach(field => {
        if (field.type === "date" && finalData[field.name] != null) {
          const value = finalData[field.name];
          if (typeof value === "string") {
            finalData[field.name] = new Date(value);
          }
        }
      });

      // Generate or validate slug
      // All collections have a slug column in their database table,
      // so we always need to generate a slug value for new entries.
      const shouldGenerateSlug = true;

      if (shouldGenerateSlug) {
        if (
          !finalData.slug ||
          typeof finalData.slug !== "string" ||
          finalData.slug.trim() === ""
        ) {
          // Try to generate slug from title field first
          const titleValue = finalData.title || finalData.name || "";
          if (typeof titleValue === "string" && titleValue.trim()) {
            finalData.slug = generateSlug(titleValue);
          } else {
            // Generate a unique slug using timestamp + random string
            finalData.slug = `entry-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
          }
        } else {
          // Sanitize user-provided slug
          finalData.slug = generateSlug(finalData.slug);
        }
      }

      // Final safety pass: ensure upload field values are IDs, not populated objects.
      fields.forEach(field => {
        if (field.type === "upload" && finalData[field.name] != null) {
          const val = finalData[field.name];
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            finalData[field.name] =
              "id" in val &&
              typeof (val as Record<string, unknown>).id === "string"
                ? (val as Record<string, unknown>).id
                : null;
          } else if (Array.isArray(val)) {
            finalData[field.name] = val.map((item: unknown) =>
              typeof item === "string"
                ? item
                : typeof item === "object" && item !== null && "id" in item
                  ? (item as Record<string, unknown>).id
                  : item
            );
          }
        }
      });

      // Prepare entry data (excluding many-to-many fields)
      // Convert camelCase field names to snake_case column names for the database.
      // The adapter uses data keys directly as column names in SQL, so they must
      // match the actual database column naming convention (snake_case).
      // Store timestamps as Date objects. Drizzle handles conversion per dialect:
      // - PostgreSQL: timestamp with timezone
      // - MySQL: datetime
      // - SQLite: integer (unix timestamp via mode:"timestamp")
      // Using Date objects (not ISO strings) because SQLite's integer mode
      // calls .getTime() which fails on strings.
      const now = new Date();
      const rawEntryData = {
        id: this.collectionService.generateId(),
        ...finalData,
        created_at: now,
        updated_at: now,
      };
      const entryData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawEntryData)) {
        entryData[toSnakeCase(key)] = value;
      }

      // Insert main entry using adapter for database-agnostic RETURNING support
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle adapter returns dynamic column shapes
      const rawEntry = await this.adapter.insert<any>(
        getTableName(params.collectionName),
        entryData,
        { returning: "*" }
      );

      // Convert snake_case keys from DB response back to camelCase field names
      // so hooks and the API response use the original field names.
      const entry: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawEntry)) {
        entry[toCamelCase(key)] = value;
      }

      // Handle many-to-many relationships
      for (const field of manyToManyFields) {
        const relatedIds = manyToManyData[field.name];
        if (relatedIds && relatedIds.length > 0) {
          await this.relationshipService.insertManyToManyRelations(
            params.collectionName,
            entry.id as string,
            field,
            relatedIds
          );
        }
      }

      // Save component field data to separate comp_{slug} tables
      if (
        this.componentDataService &&
        Object.keys(componentFieldData).length > 0
      ) {
        await this.componentDataService.saveComponentData({
          parentId: entry.id as string,
          parentTable: getTableName(params.collectionName),
          fields: fields as unknown as FieldConfig[], // FieldDefinition is compatible with FieldConfig for component detection
          data: componentFieldData,
        });
      }

      // Execute afterCreate hooks (code-registered)
      // Hooks run after database insert completes (for side effects)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: entry,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeCreate
      });

      await this.hookService.hookRegistry.execute("afterCreate", afterContext);

      // Execute stored afterCreate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterCreate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "create",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Deserialize JSON fields (richtext, blocks, array, group, json) for response
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          entry[field.name] &&
          typeof entry[field.name] === "string"
        ) {
          try {
            entry[field.name] = JSON.parse(entry[field.name] as string);
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Expand relationships in response if depth is specified
      let responseEntry = entry;
      if (depth !== undefined && depth > 0) {
        try {
          responseEntry = await this.relationshipService.expandRelationships(
            entry,
            params.collectionName,
            fields,
            { depth }
          );
        } catch (expansionError) {
          // If expansion fails, return the entry without expanded relationships
          console.warn(
            "Failed to expand relationships in createEntry response:",
            expansionError
          );
        }
      }

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: responseEntry,
      };
    } catch (error: unknown) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to create entry",
        "unique-violation":
          "Duplicate value: A unique field already has this value",
        "not-null-violation": "Missing required field",
        "fk-violation":
          "Invalid reference: The referenced entry does not exist",
        constraint:
          "Validation failed: One or more field values do not meet requirements",
      });
    }
  }

  /**
   * Update an existing entry.
   * Applies collection-level access control, field-level permissions, and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   * 2. Field-level permissions (FieldPermissionCheckerService)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @param body - Update data
   * @returns Updated entry or error
   */
  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Fetch the existing entry first (needed for access control and hooks)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [existingEntry] = await (this.db as any)
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id, data) or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "update" as OperationType,
          args: { id: params.entryId, data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeUpdate hooks (code-registered)
      // Hooks run before validation and can modify the incoming data
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: currentData,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeUpdate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeUpdate hooks (UI-configured)
      // Runs after code hooks, can further modify data
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Validate permissions if user provided and access not overridden
      if (accessUser?.id) {
        // Check field-level write permissions
        const fieldNames = Object.keys(finalData);
        for (const fieldName of fieldNames) {
          const canWrite = await this.fieldPermissionChecker.canAccessField(
            accessUser.id,
            params.collectionName,
            fieldName,
            "write",
            existingEntry
          );

          if (!canWrite) {
            return {
              success: false,
              statusCode: 403,
              message: `You do not have permission to update the field "${fieldName}"`,
              data: null,
            };
          }
        }
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f => f.type === "relation" && f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      // Extract many-to-many data from finalData (after hooks)
      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name]; // Remove from main update
        }
      });

      // Extract component field data (stored in separate comp_{slug} tables)
      // Component fields should not be stored in the collection table
      const componentFieldData: Record<string, unknown> = {};
      fields.forEach(field => {
        if (
          isComponentField(field as unknown as FieldConfig) &&
          finalData[field.name] !== undefined
        ) {
          componentFieldData[field.name] = finalData[field.name];
          delete finalData[field.name]; // Remove from main update
        }
      });

      // Normalize relationship data inside repeater/group fields before serialization.
      // The admin panel may send full relationship objects ({id, title, slug, ...})
      // inside repeater rows — strip these down to just IDs to prevent bloated JSON.
      fields.forEach(field => {
        if (
          (field.type === "repeater" || field.type === "group") &&
          finalData[field.name] != null &&
          typeof finalData[field.name] === "object"
        ) {
          const nestedFields = (field.fields || []) as FieldDefinition[];
          if (
            nestedFields.some(
              f =>
                isRelationshipField(f.type) ||
                f.type === "repeater" ||
                f.type === "group"
            )
          ) {
            if (
              field.type === "repeater" &&
              Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = (finalData[field.name] as unknown[]).map(
                (row: unknown) =>
                  row && typeof row === "object" && !Array.isArray(row)
                    ? normalizeNestedRelationships(
                        row as Record<string, unknown>,
                        nestedFields
                      )
                    : row
              );
            } else if (
              field.type === "group" &&
              !Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = normalizeNestedRelationships(
                finalData[field.name] as Record<string, unknown>,
                nestedFields
              );
            }
          }
        }
      });

      // Serialize JSON fields (richtext, blocks, array, group, json)
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          finalData[field.name] != null
        ) {
          const value = finalData[field.name];
          // Only stringify if it's an object/array and not already a string
          if (typeof value === "object") {
            finalData[field.name] = JSON.stringify(value);
          } else if (typeof value === "string") {
            // Already a string - check if it's valid JSON to avoid double-serialization
            try {
              JSON.parse(value);
              // It's already valid JSON string, keep as-is
            } catch {
              // Not valid JSON string - this is unusual for JSON fields
              console.warn(
                `[updateEntry] Field "${field.name}" (type: ${field.type}) is a string but not valid JSON`
              );
            }
          }
        }
      });

      // Convert date field strings to Date objects
      // This is necessary because Drizzle ORM expects Date objects for timestamp fields
      // (especially SQLite with mode: 'timestamp'), but the API receives ISO strings
      fields.forEach(field => {
        if (field.type === "date" && finalData[field.name] != null) {
          const value = finalData[field.name];
          if (typeof value === "string") {
            finalData[field.name] = new Date(value);
          }
        }
      });

      // Sanitize slug if provided in update
      // - Dynamic collections (UI-created) always have a slug column
      // - Plugin collections (isPlugin: true) only have slug if explicitly defined
      const isPluginCollection =
        (
          (collection as Record<string, unknown>).admin as
            | Record<string, unknown>
            | undefined
        )?.isPlugin === true;
      const hasSlugField = fields.some(f => f.name === "slug");
      const shouldHandleSlug = isPluginCollection ? hasSlugField : true;

      if (shouldHandleSlug && finalData.slug !== undefined) {
        if (typeof finalData.slug === "string" && finalData.slug.trim()) {
          finalData.slug = generateSlug(finalData.slug);
        } else {
          // If slug is empty/null, remove it from update to keep existing value
          delete finalData.slug;
        }
      }

      // Final safety pass: ensure upload field values are IDs, not populated objects.
      fields.forEach(field => {
        if (field.type === "upload" && finalData[field.name] != null) {
          const val = finalData[field.name];
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            finalData[field.name] =
              "id" in val &&
              typeof (val as Record<string, unknown>).id === "string"
                ? (val as Record<string, unknown>).id
                : null;
          } else if (Array.isArray(val)) {
            finalData[field.name] = val.map((item: unknown) =>
              typeof item === "string"
                ? item
                : typeof item === "object" && item !== null && "id" in item
                  ? (item as Record<string, unknown>).id
                  : item
            );
          }
        }
      });

      // Update main entry
      // Use Date object (not .toISOString() string) because Drizzle's timestamp()
      // column without mode:'string' expects Date objects and calls .toISOString()
      // internally during serialization. Passing a string causes
      // "value.toISOString is not a function".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .update(schema)
        .set({
          ...finalData,
          updatedAt: new Date(),
        })
        .where(eq(schema.id, params.entryId));
      // .returning();

      // Fetch the updated entry to return it and use in hooks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [updated] = await (this.db as any)
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Handle many-to-many relationships (replace existing relations)
      for (const field of manyToManyFields) {
        if (manyToManyData[field.name] !== undefined) {
          // Delete existing relations
          await this.relationshipService.deleteManyToManyRelations(
            params.collectionName,
            params.entryId,
            field
          );

          // Insert new relations
          const relatedIds = manyToManyData[field.name];
          if (relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              params.entryId,
              field,
              relatedIds
            );
          }
        }
      }

      // Save component field data to separate comp_{slug} tables
      if (
        this.componentDataService &&
        Object.keys(componentFieldData).length > 0
      ) {
        await this.componentDataService.saveComponentData({
          parentId: params.entryId,
          parentTable: getTableName(params.collectionName),
          fields: fields as unknown as FieldConfig[], // FieldDefinition is compatible with FieldConfig for component detection
          data: componentFieldData,
        });
      }

      // Execute afterUpdate hooks (code-registered)
      // Hooks run after database update completes (for side effects)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: updated,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeUpdate
      });

      await this.hookService.hookRegistry.execute("afterUpdate", afterContext);

      // Execute stored afterUpdate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterUpdate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "update",
          updated,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Deserialize JSON fields (richtext, blocks, array, group, json) for response
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          updated[field.name] &&
          typeof updated[field.name] === "string"
        ) {
          try {
            updated[field.name] = JSON.parse(updated[field.name] as string);
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Expand relationships in response if depth is specified
      let responseEntry = updated;
      if (depth !== undefined && depth > 0) {
        try {
          responseEntry = await this.relationshipService.expandRelationships(
            updated,
            params.collectionName,
            fields,
            { depth }
          );
        } catch (expansionError) {
          // If expansion fails, return the entry without expanded relationships
          console.warn(
            "Failed to expand relationships in updateEntry response:",
            expansionError
          );
        }
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: responseEntry,
      };
    } catch (error: unknown) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to update entry",
        "unique-violation":
          "Duplicate value: A unique field already has this value",
        "not-null-violation": "Missing required field",
        "fk-violation":
          "Invalid reference: The referenced entry does not exist",
        constraint:
          "Validation failed: One or more field values do not meet requirements",
      });
    }
  }

  /**
   * Delete an entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   */
  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Fetch the entry first (needed for access control and hooks)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [entry] = await (this.db as any)
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "delete",
        accessUser,
        params.entryId,
        entry,
        params.overrideAccess
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata for stored hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id) or throw to abort
      await this.hookService.hookRegistry.executeBeforeOperation({
        collection: params.collectionName,
        operation: "delete" as OperationType,
        args: { id: params.entryId },
        user: params.user
          ? { id: params.user.id, email: params.user.email }
          : undefined,
        context: sharedContext,
      });

      // Note: For delete, we don't use modified id since we already fetched the entry
      // and checked access. The hook can throw to abort if needed.

      // Execute beforeDelete hooks (code-registered)
      // Hooks run before deletion and can prevent deletion by throwing error
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute(
        "beforeDelete",
        beforeContext
      );

      // Execute stored beforeDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "beforeDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
        const collectionFields = (collection.schemaDefinition?.fields ||
          collection.fields ||
          []) as FieldConfig[];
        await this.componentDataService.deleteComponentData({
          parentId: params.entryId,
          parentTable: getTableName(params.collectionName),
          fields: collectionFields,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .delete(schema)
        .where(eq(schema.id, params.entryId));
      // .returning();

      const deleted = entry;

      if (!deleted) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Execute afterDelete hooks (code-registered)
      // Hooks run after deletion completes (for cleanup)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: deleted,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeDelete
      });

      await this.hookService.hookRegistry.execute("afterDelete", afterContext);

      // Execute stored afterDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          deleted,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
      };
    }
  }

  // ============================================================
  // Transaction-aware methods
  // ============================================================

  /**
   * Create a new entry within an existing transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @returns Created entry or error
   * @throws Error if transaction operations fail
   *
   * @example
   * ```typescript
   * await adapter.transaction(async (tx) => {
   *   const entry = await entryService.createEntryInTransaction(tx, params, data);
   *   // Other operations in the same transaction...
   * });
   * ```
   */
  async createEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        params.user
      );
      if (accessDenied) {
        return accessDenied;
      }

      const tableName = getTableName(params.collectionName);

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "create" as OperationType,
          args: { data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeCreate hooks (code-registered)
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: currentData,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeCreate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeCreate hooks (UI-configured)
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Validate permissions if user provided
      if (params.user?.id) {
        const fieldNames = Object.keys(finalData);
        for (const fieldName of fieldNames) {
          const canWrite = await this.fieldPermissionChecker.canAccessField(
            params.user.id,
            params.collectionName,
            fieldName,
            "write"
          );

          if (!canWrite) {
            return {
              success: false,
              statusCode: 403,
              message: `You do not have permission to set the field "${fieldName}"`,
              data: null,
            };
          }
        }
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f => f.type === "relation" && f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      // Convert date field strings to Date objects
      // This is necessary because Drizzle ORM expects Date objects for timestamp fields
      fields.forEach(field => {
        if (field.type === "date" && finalData[field.name] != null) {
          const value = finalData[field.name];
          if (typeof value === "string") {
            finalData[field.name] = new Date(value);
          }
        }
      });

      // Prepare entry data
      const nowForTxCreate = new Date();
      const entryData = {
        id: this.collectionService.generateId(),
        ...finalData,
        createdAt: nowForTxCreate,
        updatedAt: nowForTxCreate,
      };

      // Insert using transaction context
      const entry = await tx.insert<unknown>(tableName, entryData, {
        returning: "*",
      });

      // Handle many-to-many relationships
      for (const field of manyToManyFields) {
        const relatedIds = manyToManyData[field.name];
        if (relatedIds && relatedIds.length > 0) {
          await this.relationshipService.insertManyToManyRelations(
            params.collectionName,
            (entry as Record<string, unknown>).id as string,
            field,
            relatedIds
          );
        }
      }

      // Execute afterCreate hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("afterCreate", afterContext);

      // Execute stored afterCreate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterCreate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "create",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: entry,
      };
    } catch (error: unknown) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to create entry in transaction",
        "unique-violation":
          "Duplicate value: A unique field already has this value",
        "not-null-violation": "Missing required field",
        "fk-violation":
          "Invalid reference: The referenced entry does not exist",
        constraint:
          "Validation failed: One or more field values do not meet requirements",
      });
    }
  }

  /**
   * Update an entry within an existing transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name, entry ID, and optional user context
   * @param body - Update data
   * @returns Updated entry or error
   * @throws Error if transaction operations fail
   */
  async updateEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; entryId: string; user?: UserContext },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      const tableName = getTableName(params.collectionName);

      // Fetch existing entry first (needed for access control)
      const existingEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        {
          where: this.whereEq("id", params.entryId),
        }
      );

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        params.user,
        params.entryId,
        existingEntry
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id, data) or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "update" as OperationType,
          args: { id: params.entryId, data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeUpdate hooks (code-registered)
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: currentData,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeUpdate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeUpdate hooks (UI-configured)
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Validate permissions if user provided
      if (params.user?.id) {
        const fieldNames = Object.keys(finalData);
        for (const fieldName of fieldNames) {
          const canWrite = await this.fieldPermissionChecker.canAccessField(
            params.user.id,
            params.collectionName,
            fieldName,
            "write",
            existingEntry
          );

          if (!canWrite) {
            return {
              success: false,
              statusCode: 403,
              message: `You do not have permission to update the field "${fieldName}"`,
              data: null,
            };
          }
        }
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate many-to-many relations
      const manyToManyFields = fields.filter(
        f => f.type === "relation" && f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      // Convert date field strings to Date objects
      // This is necessary because Drizzle ORM expects Date objects for timestamp fields
      fields.forEach(field => {
        if (field.type === "date" && finalData[field.name] != null) {
          const value = finalData[field.name];
          if (typeof value === "string") {
            finalData[field.name] = new Date(value);
          }
        }
      });

      // Update using transaction context
      // IMPORTANT: Use UTC ISO string for updatedAt to ensure consistent timezone handling
      const [updated] = await tx.update<unknown>(
        tableName,
        {
          ...finalData,
          updatedAt: new Date(),
        },
        this.whereEq("id", params.entryId),
        { returning: "*" }
      );

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Handle many-to-many relationships
      for (const field of manyToManyFields) {
        if (manyToManyData[field.name] !== undefined) {
          await this.relationshipService.deleteManyToManyRelations(
            params.collectionName,
            params.entryId,
            field
          );

          const relatedIds = manyToManyData[field.name];
          if (relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              params.entryId,
              field,
              relatedIds
            );
          }
        }
      }

      // Execute afterUpdate hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: updated,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("afterUpdate", afterContext);

      // Execute stored afterUpdate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterUpdate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "update",
          updated,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: updated,
      };
    } catch (error: unknown) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to update entry in transaction",
        "unique-violation":
          "Duplicate value: A unique field already has this value",
        "not-null-violation": "Missing required field",
        "fk-violation":
          "Invalid reference: The referenced entry does not exist",
        constraint:
          "Validation failed: One or more field values do not meet requirements",
      });
    }
  }

  /**
   * Delete an entry within an existing transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   * @throws Error if transaction operations fail
   */
  async deleteEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    try {
      const tableName = getTableName(params.collectionName);

      // Fetch entry first (needed for access control and hooks)
      const entry = await tx.selectOne<Record<string, unknown>>(tableName, {
        where: this.whereEq("id", params.entryId),
      });

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess<{
        deleted: boolean;
      }>(params.collectionName, "delete", params.user, params.entryId, entry);
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata and stored hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id) or throw to abort
      await this.hookService.hookRegistry.executeBeforeOperation({
        collection: params.collectionName,
        operation: "delete" as OperationType,
        args: { id: params.entryId },
        user: params.user
          ? { id: params.user.id, email: params.user.email }
          : undefined,
        context: sharedContext,
      });

      // Note: For delete, we don't use modified id since we already fetched the entry
      // and checked access. The hook can throw to abort if needed.

      // Execute beforeDelete hooks (code-registered)
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute(
        "beforeDelete",
        beforeContext
      );

      // Execute stored beforeDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "beforeDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
        const collectionFields = (collection.schemaDefinition?.fields ||
          collection.fields ||
          []) as FieldConfig[];
        await this.componentDataService.deleteComponentDataInTransaction(tx, {
          parentId: params.entryId,
          parentTable: tableName,
          fields: collectionFields,
        });
      }

      // Delete using transaction context
      const deletedCount = await tx.delete(
        tableName,
        this.whereEq("id", params.entryId)
      );

      if (deletedCount === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Execute afterDelete hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("afterDelete", afterContext);

      // Execute stored afterDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete entry in transaction",
        data: null,
      };
    }
  }

  // ============================================================
  // Single-entry transaction helpers (used by CollectionBulkService)
  // ============================================================

  /**
   * Internal helper to create a single entry within a transaction.
   *
   * This is a streamlined version of createEntryInTransaction that:
   * - Skips collection-level access check (done once by caller)
   * - Optionally skips hooks for performance
   * - Returns the same result format
   *
   * @param tx - Transaction context
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @param skipHooks - Whether to skip hook execution
   * @returns CollectionServiceResult with created entry or error
   */
  async createSingleEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      const tableName = getTableName(params.collectionName);

      // Get collection metadata to identify relation fields
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      let currentData: Record<string, unknown> = { ...body };

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute hooks (unless skipped)
      if (!skipHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments or throw to abort
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "create" as OperationType,
            args: { data: body },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: sharedContext,
          });

        // Use modified data if returned by beforeOperation
        currentData =
          ((beforeOpArgs as BeforeOperationArgs)?.data as Record<
            string,
            unknown
          >) ?? body;

        // Execute beforeCreate hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: currentData,
          user: params.user,
          context: sharedContext,
        });

        const modifiedData = await this.hookService.hookRegistry.execute(
          "beforeCreate",
          beforeContext
        );
        currentData = (modifiedData ?? currentData) as Record<string, unknown>;

        // Execute stored beforeCreate hooks (UI-configured)
        const storedBeforeResult =
          await this.hookService.storedHookExecutor.execute(
            "beforeCreate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext(
              params.collectionName,
              "create",
              currentData,
              this.queryDatabaseFn,
              params.user,
              sharedContext
            )
          );
        currentData = (storedBeforeResult.data ?? currentData) as Record<
          string,
          unknown
        >;
      }

      const finalData = currentData;

      // Validate permissions if user provided
      if (params.user?.id) {
        const fieldNames = Object.keys(finalData);
        for (const fieldName of fieldNames) {
          const canWrite = await this.fieldPermissionChecker.canAccessField(
            params.user.id,
            params.collectionName,
            fieldName,
            "write"
          );

          if (!canWrite) {
            return {
              success: false,
              statusCode: 403,
              message: `You do not have permission to set the field "${fieldName}"`,
              data: null,
            };
          }
        }
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f => f.type === "relation" && f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      // Convert date field strings to Date objects
      // This is necessary because Drizzle ORM expects Date objects for timestamp fields
      fields.forEach(field => {
        if (field.type === "date" && finalData[field.name] != null) {
          const value = finalData[field.name];
          if (typeof value === "string") {
            finalData[field.name] = new Date(value);
          }
        }
      });

      // Prepare entry data
      const nowForTxCreate = new Date();
      const entryData = {
        id: this.collectionService.generateId(),
        ...finalData,
        createdAt: nowForTxCreate,
        updatedAt: nowForTxCreate,
      };

      // Insert using transaction context
      const entry = await tx.insert<unknown>(tableName, entryData, {
        returning: "*",
      });

      // Handle many-to-many relationships
      for (const field of manyToManyFields) {
        const relatedIds = manyToManyData[field.name];
        if (relatedIds && relatedIds.length > 0) {
          await this.relationshipService.insertManyToManyRelations(
            params.collectionName,
            (entry as Record<string, unknown>).id as string,
            field,
            relatedIds
          );
        }
      }

      // Execute afterCreate hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterCreate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "afterCreate",
          afterContext
        );

        // Execute stored afterCreate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: entry,
      };
    } catch (error: unknown) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to create entry",
        "unique-violation":
          "Duplicate value: A unique field already has this value",
        "not-null-violation": "Missing required field",
        "fk-violation":
          "Invalid reference: The referenced entry does not exist",
        constraint:
          "Validation failed: One or more field values do not meet requirements",
      });
    }
  }

  /**
   * Internal helper to update a single entry within a transaction.
   *
   * This is a streamlined version of updateEntryInTransaction that:
   * - Skips collection-level access check (done once by caller)
   * - Optionally skips hooks for performance
   * - Returns the same result format
   *
   * @param tx - Transaction context
   * @param params - Collection name and optional user context
   * @param entryId - ID of the entry to update
   * @param body - Partial data to update
   * @param skipHooks - Whether to skip hook execution
   * @returns CollectionServiceResult with updated entry or error
   */
  async updateSingleEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    entryId: string,
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      const tableName = getTableName(params.collectionName);

      // Fetch existing entry first (needed for owner checks and hooks)
      const existingEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        {
          where: this.whereEq("id", entryId),
        }
      );

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Check owner-only access if applicable (document-level check)
      // This is needed because the initial collection-level check doesn't have the document
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const accessRules = this.accessService.getAccessRules(
        collection as Record<string, unknown>
      );

      if (accessRules?.update?.type === "owner-only" && params.user) {
        const ownerField = accessRules.update.ownerField ?? "createdBy";
        const ownerId = existingEntry[ownerField];
        if (ownerId !== params.user.id) {
          return {
            success: false,
            statusCode: 403,
            message: "You can only update your own entries",
            data: null,
          };
        }
      }

      // Get collection metadata to identify relation fields
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      let currentData: Record<string, unknown> = { ...body };

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute hooks (unless skipped)
      if (!skipHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments (id, data) or throw to abort
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "update" as OperationType,
            args: { id: entryId, data: body },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: sharedContext,
          });

        // Use modified data if returned by beforeOperation
        currentData =
          ((beforeOpArgs as BeforeOperationArgs)?.data as Record<
            string,
            unknown
          >) ?? body;

        // Execute beforeUpdate hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: currentData,
          originalData: existingEntry,
          user: params.user,
          context: sharedContext,
        });

        const modifiedData = await this.hookService.hookRegistry.execute(
          "beforeUpdate",
          beforeContext
        );
        currentData = (modifiedData ?? currentData) as Record<string, unknown>;

        // Execute stored beforeUpdate hooks (UI-configured)
        const storedBeforeResult =
          await this.hookService.storedHookExecutor.execute(
            "beforeUpdate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext(
              params.collectionName,
              "update",
              currentData,
              this.queryDatabaseFn,
              params.user,
              sharedContext
            )
          );
        currentData = (storedBeforeResult.data ?? currentData) as Record<
          string,
          unknown
        >;
      }

      const finalData = currentData;

      // Validate permissions if user provided
      if (params.user?.id) {
        const fieldNames = Object.keys(finalData);
        for (const fieldName of fieldNames) {
          const canWrite = await this.fieldPermissionChecker.canAccessField(
            params.user.id,
            params.collectionName,
            fieldName,
            "write",
            existingEntry
          );

          if (!canWrite) {
            return {
              success: false,
              statusCode: 403,
              message: `You do not have permission to update the field "${fieldName}"`,
              data: null,
            };
          }
        }
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f => f.type === "relation" && f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      // Convert date field strings to Date objects
      // This is necessary because Drizzle ORM expects Date objects for timestamp fields
      fields.forEach(field => {
        if (field.type === "date" && finalData[field.name] != null) {
          const value = finalData[field.name];
          if (typeof value === "string") {
            finalData[field.name] = new Date(value);
          }
        }
      });

      // Update using transaction context
      // IMPORTANT: Use UTC ISO string for updatedAt to ensure consistent timezone handling
      const [updated] = await tx.update<unknown>(
        tableName,
        {
          ...finalData,
          updatedAt: new Date(),
        },
        this.whereEq("id", entryId),
        { returning: "*" }
      );

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Handle many-to-many relationships (replace existing relations)
      for (const field of manyToManyFields) {
        if (manyToManyData[field.name] !== undefined) {
          // Delete existing relations
          await this.relationshipService.deleteManyToManyRelations(
            params.collectionName,
            entryId,
            field
          );

          // Insert new relations
          const relatedIds = manyToManyData[field.name];
          if (relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              entryId,
              field,
              relatedIds
            );
          }
        }
      }

      // Execute afterUpdate hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterUpdate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: updated,
          originalData: existingEntry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "afterUpdate",
          afterContext
        );

        // Execute stored afterUpdate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            updated,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: updated,
      };
    } catch (error: unknown) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to update entry",
        "unique-violation":
          "Duplicate value: A unique field already has this value",
        "not-null-violation": "Missing required field",
        "fk-violation":
          "Invalid reference: The referenced entry does not exist",
        constraint:
          "Validation failed: One or more field values do not meet requirements",
      });
    }
  }

  /**
   * Internal helper to delete a single entry within a transaction.
   *
   * This is a streamlined version of deleteEntryInTransaction that:
   * - Skips collection-level access check (done once by caller)
   * - Optionally skips hooks for performance
   * - Returns the same result format
   *
   * @param tx - Transaction context
   * @param params - Collection name and optional user context
   * @param entryId - ID of the entry to delete
   * @param skipHooks - Whether to skip hook execution
   * @returns CollectionServiceResult with deletion status
   */
  async deleteSingleEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    entryId: string,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    try {
      const tableName = getTableName(params.collectionName);

      // Fetch entry first (needed for owner checks and hooks)
      const entry = await tx.selectOne<Record<string, unknown>>(tableName, {
        where: this.whereEq("id", entryId),
      });

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Check owner-only access if applicable (document-level check)
      // This is needed because the initial collection-level check doesn't have the document
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const accessRules = this.accessService.getAccessRules(
        collection as Record<string, unknown>
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      if (accessRules?.delete?.type === "owner-only" && params.user) {
        const ownerField = accessRules.delete.ownerField ?? "createdBy";
        const ownerId = entry[ownerField];
        if (ownerId !== params.user.id) {
          return {
            success: false,
            statusCode: 403,
            message: "You can only delete your own entries",
            data: null,
          };
        }
      }

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute hooks (unless skipped)
      if (!skipHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments (id) or throw to abort
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "delete" as OperationType,
          args: { id: entryId },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

        // Note: For delete, we don't use modified id since we already fetched the entry
        // and checked access. The hook can throw to abort if needed.

        // Execute beforeDelete hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "beforeDelete",
          beforeContext
        );

        // Execute stored beforeDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "beforeDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "delete",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
        const collectionFields = (collection.schemaDefinition?.fields ||
          collection.fields ||
          []) as FieldConfig[];
        await this.componentDataService.deleteComponentDataInTransaction(tx, {
          parentId: entryId,
          parentTable: tableName,
          fields: collectionFields,
        });
      }

      // Delete using transaction context
      const deletedCount = await tx.delete(
        tableName,
        this.whereEq("id", entryId)
      );

      if (deletedCount === 0) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Execute afterDelete hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterDelete hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "afterDelete",
          afterContext
        );

        // Execute stored afterDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "delete",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
      };
    }
  }
}
