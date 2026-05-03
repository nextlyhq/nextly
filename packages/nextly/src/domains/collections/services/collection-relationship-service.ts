import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq, inArray, sql } from "drizzle-orm";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { getDialectTables } from "../../../database";
import { keysToCamelCase } from "../../../lib/case-conversion";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { DynamicCollectionService } from "../../dynamic-collections";

/**
 * Default depth for relationship population.
 * Default depth for relationship population.
 */
export const DEFAULT_RELATIONSHIP_DEPTH = 2;

/**
 * Maximum allowed depth to prevent performance issues.
 */
export const MAX_RELATIONSHIP_DEPTH = 5;

/**
 * Options for relationship expansion.
 */
export interface RelationshipExpansionOptions {
  /**
   * Maximum depth to expand relationships (0-5).
   * - 0: No expansion, return IDs only
   * - 1: Expand immediate relationships
   * - 2+: Expand nested relationships recursively
   * @default 2
   */
  depth?: number;

  /**
   * Current depth level (used internally for recursion).
   * @internal
   */
  currentDepth?: number;
}

/**
 * Checks if a field is a relationship field.
 */
function isRelationshipField(field: FieldDefinition): boolean {
  return field.type === "relationship";
}

/**
 * Checks if a field is an upload field.
 */
function isUploadField(field: FieldDefinition): boolean {
  return field.type === "upload";
}

/**
 * Checks if a field is an array field (repeater with nested fields).
 */
function isArrayField(field: FieldDefinition): boolean {
  return field.type === "repeater" || field.type === "group";
}

/**
 * Checks if a field is a group field (container with nested fields).
 */
function isGroupField(field: FieldDefinition): boolean {
  return field.type === "group";
}

/**
 * Gets nested fields from an array or group field.
 */
function getNestedFields(field: FieldDefinition): FieldDefinition[] {
  if (field.fields && Array.isArray(field.fields)) {
    return field.fields;
  }
  return [];
}

/**
 * Safely parses JSON data if it's a string, otherwise returns as-is.
 * Handles cases where array/group field data hasn't been deserialized yet.
 */
function parseJsonIfString(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

/**
 * Extracts the ID from a relationship field value.
 * Handles both raw IDs (strings) and expanded objects ({id: "..."}).
 */
function extractRelationshipId(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value !== null &&
    "id" in value
  ) {
    return (value as Record<string, unknown>).id;
  }
  return value;
}

/**
 * Strips expanded relationship objects in a data row down to just their IDs.
 * Used when depth=0 to ensure no nested relationships are returned as full objects.
 * Recursively handles nested repeater/group fields.
 */
function stripRelationshipsToIds(
  row: Record<string, unknown>,
  fields: FieldDefinition[]
): Record<string, unknown> {
  const stripped = { ...row };

  for (const field of fields) {
    const fieldName = field.name;
    if (
      !fieldName ||
      stripped[fieldName] === undefined ||
      stripped[fieldName] === null
    )
      continue;

    if (isRelationshipField(field)) {
      const hasMany =
        field.hasMany || field.options?.relationType === "manyToMany";
      const value = stripped[fieldName];

      if (hasMany && Array.isArray(value)) {
        stripped[fieldName] = value.map(v => extractRelationshipId(v));
      } else {
        stripped[fieldName] = extractRelationshipId(value);
      }
    } else if (field.type === "repeater" || field.type === "group") {
      const nestedFields = getNestedFields(field);
      if (nestedFields.length === 0) continue;

      const rawData = stripped[fieldName];
      const parsed = parseJsonIfString(rawData);

      if (field.type === "repeater" && Array.isArray(parsed)) {
        stripped[fieldName] = parsed.map((item: Record<string, unknown>) => {
          if (item && typeof item === "object") {
            return stripRelationshipsToIds(item, nestedFields);
          }
          return item;
        });
      } else if (
        field.type === "group" &&
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        stripped[fieldName] = stripRelationshipsToIds(
          parsed as Record<string, unknown>,
          nestedFields
        );
      }
    }
  }

  return stripped;
}

/**
 * Checks if a target collection name is a system entity.
 * System entities are managed tables like users, not dynamic collections.
 */
function isSystemEntity(targetName: string): boolean {
  const systemEntities = ["users", "roles", "permissions"];
  return systemEntities.includes(targetName.toLowerCase());
}

/**
 * Gets the system table schema for known system entities.
 * @param targetName - System entity name (e.g., "users")
 * @param dialect - Database dialect
 * @returns Schema or null if not a valid system entity
 */
function getSystemEntityTable(targetName: string, dialect?: string) {
  if (targetName.toLowerCase() !== "users") return null;

  const tables = getDialectTables(dialect);
  return tables.users;
}

/**
 * Gets the default label field for a system entity.
 * @param targetName - System entity name
 * @returns Default label field name
 */
function getSystemEntityLabelField(targetName: string): string {
  if (targetName.toLowerCase() === "users") {
    return "name"; // Users have a "name" field for display
  }
  return "id"; // Fallback to ID
}

/**
 * Recursively collects all media IDs from a data object based on field definitions.
 * Handles nested upload fields inside array and group fields.
 *
 * @param data - The data object to extract media IDs from
 * @param fields - Field definitions
 * @returns Array of all media IDs found
 */
function collectAllMediaIds(
  data: Record<string, unknown>,
  fields: FieldDefinition[]
): string[] {
  if (!data || typeof data !== "object") return [];

  const mediaIds: string[] = [];

  for (const field of fields) {
    const fieldName = field.name;
    if (!fieldName || data[fieldName] === undefined || data[fieldName] === null)
      continue;

    if (isUploadField(field)) {
      // Upload field - collect its IDs
      const ids = normalizeToIdArray(data[fieldName]);
      mediaIds.push(...ids);
    } else if (isArrayField(field)) {
      // Array field - recurse into each row
      // Handle both parsed arrays and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawArrayData = data[fieldName];
      const arrayData = parseJsonIfString(rawArrayData);
      if (Array.isArray(arrayData)) {
        for (const row of arrayData) {
          if (row && typeof row === "object") {
            const nestedIds = collectAllMediaIds(row, nestedFields);
            mediaIds.push(...nestedIds);
          }
        }
      }
    } else if (isGroupField(field)) {
      // Group field - recurse into the group object
      // Handle both parsed objects and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawGroupData = data[fieldName];
      const groupData = parseJsonIfString(rawGroupData);
      if (
        groupData &&
        typeof groupData === "object" &&
        !Array.isArray(groupData)
      ) {
        const nestedIds = collectAllMediaIds(
          groupData as Record<string, unknown>,
          nestedFields
        );
        mediaIds.push(...nestedIds);
      }
    }
  }

  return mediaIds;
}

/**
 * Recursively expands media IDs in a data object using the provided media lookup map.
 * Handles nested upload fields inside array and group fields.
 *
 * @param data - The data object to expand
 * @param fields - Field definitions
 * @param mediaMap - Map of media ID to full media object
 * @returns The data with expanded media objects
 */
function expandMediaInData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive data structure
  data: any,
  fields: FieldDefinition[],
  mediaMap: Map<string, Record<string, unknown>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive data structure
): any {
  if (!data || typeof data !== "object") return data;

  const result = Array.isArray(data) ? [...data] : { ...data };

  for (const field of fields) {
    const fieldName = field.name;
    if (!fieldName || result[fieldName] === undefined) continue;

    if (isUploadField(field)) {
      // Upload field - expand IDs to full media objects
      const value = result[fieldName];
      if (value === null || value === undefined) continue;

      const hasMany = field.hasMany === true;
      const ids = normalizeToIdArray(value);

      if (ids.length === 0) {
        result[fieldName] = hasMany ? [] : null;
      } else if (hasMany) {
        // Return array of media objects, maintaining order
        result[fieldName] = ids
          .map(id => mediaMap.get(String(id)))
          .filter(Boolean);
      } else {
        // Return single media object
        result[fieldName] = mediaMap.get(String(ids[0])) || null;
      }
    } else if (isArrayField(field)) {
      // Array field - recurse into each row
      // Handle both parsed arrays and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawArrayData = result[fieldName];
      const arrayData = parseJsonIfString(rawArrayData);
      if (Array.isArray(arrayData)) {
        result[fieldName] = arrayData.map(row => {
          if (row && typeof row === "object") {
            return expandMediaInData(row, nestedFields, mediaMap);
          }
          return row;
        });
      }
    } else if (isGroupField(field)) {
      // Group field - recurse into the group object
      // Handle both parsed objects and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawGroupData = result[fieldName];
      const groupData = parseJsonIfString(rawGroupData);
      if (
        groupData &&
        typeof groupData === "object" &&
        !Array.isArray(groupData)
      ) {
        result[fieldName] = expandMediaInData(
          groupData,
          nestedFields,
          mediaMap
        );
      }
    }
  }

  return result;
}

/**
 * Gets the target collection name from a relationship field.
 * For polymorphic relationships (relationTo is array), returns the first collection.
 */
function getTargetCollection(field: FieldDefinition): string | undefined {
  if (field.relationTo) {
    return Array.isArray(field.relationTo)
      ? field.relationTo[0]
      : field.relationTo;
  }
  return undefined;
}

/**
 * Determines if a relationship field stores multiple values.
 * Code-first relationship fields use hasMany; UI-built collections use
 * options.relationType === "manyToMany". Either signals many-to-many.
 */
function isHasManyRelationship(field: FieldDefinition): boolean {
  if (field.options?.relationType === "manyToMany") {
    return true;
  }
  if (field.hasMany === true) {
    return true;
  }
  return false;
}

/**
 * Parses a PostgreSQL array string into a JavaScript array.
 * PostgreSQL arrays are returned as strings like: {"uuid1","uuid2"}
 */
function parsePostgresArray(value: unknown): string[] | null {
  if (typeof value !== "string") {
    return null;
  }
  // Check if it's a PostgreSQL array format: {item1,item2} or {"item1","item2"}
  if (value.startsWith("{") && value.endsWith("}")) {
    const inner = value.slice(1, -1);
    if (inner === "") return [];
    // Handle quoted values: {"uuid1","uuid2"}
    // Split by comma, but handle quoted strings
    const items: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      if (char === '"' && (i === 0 || inner[i - 1] !== "\\")) {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        items.push(current.replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    if (current) {
      items.push(current.replace(/^"|"$/g, ""));
    }
    return items;
  }
  return null;
}

/**
 * Normalizes a relationship field value to an array of IDs.
 * Handles various formats:
 * - Single string ID
 * - Array of string IDs
 * - PostgreSQL array string format
 * - Objects with id property
 * - Polymorphic objects with value property
 */
function normalizeToIdArray(value: unknown): string[] {
  if (value == null) return [];

  // Already an array
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        return String(
          (item as Record<string, unknown>).value ||
            (item as Record<string, unknown>).id ||
            item
        );
      }
      return String(item);
    });
  }

  // PostgreSQL array string
  const parsed = parsePostgresArray(value);
  if (parsed !== null) {
    return parsed;
  }

  // JSON array string (from serialized upload fields with hasMany)
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const jsonParsed = JSON.parse(value);
      if (Array.isArray(jsonParsed)) {
        return jsonParsed.map(item => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            return String(
              (item as Record<string, unknown>).value ||
                (item as Record<string, unknown>).id ||
                item
            );
          }
          return String(item);
        });
      }
    } catch {
      // Not valid JSON, fall through to single string handling
    }
  }

  // Single string ID
  if (typeof value === "string") {
    return [value];
  }

  // Object with id or value
  if (typeof value === "object" && value !== null) {
    const id =
      (value as Record<string, unknown>).value ||
      (value as Record<string, unknown>).id;
    if (id) return [String(id)];
  }

  return [];
}

/**
 * CollectionRelationshipService handles all relationship expansion and junction table operations
 * for dynamic collections.
 *
 * Responsibilities:
 * - Expand relationships for single entries and batch operations
 * - Fetch related entries (oneToOne, manyToOne, oneToMany)
 * - Manage many-to-many relationships via junction tables
 * - Determine best label fields for display
 *
 * Uses the database adapter pattern for multi-database support (PostgreSQL, MySQL, SQLite).
 * Currently uses Drizzle queries with dynamic schemas and SQL tagged templates for complex
 * relationship queries that involve dynamic table names.
 *
 * @extends BaseService - Provides adapter access and Drizzle compatibility layer
 *
 * @example
 * ```typescript
 * const relationshipService = new CollectionRelationshipService(
 *   adapter, logger, fileManager, collectionService
 * );
 * const expanded = await relationshipService.expandRelationships(entry, 'posts', fields);
 * ```
 */
export class CollectionRelationshipService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService
  ) {
    super(adapter, logger);
  }

  /**
   * Determine the best label field for a collection.
   * Tries to find a meaningful text field, not just ID.
   *
   * @param collectionName - Name of the collection or system entity
   * @param targetLabelField - Optional explicitly specified label field
   * @returns The best field name to use as a label
   */
  async getBestLabelField(
    collectionName: string,
    targetLabelField?: string
  ): Promise<string> {
    try {
      // Check if this is a system entity first
      if (isSystemEntity(collectionName)) {
        return targetLabelField || getSystemEntityLabelField(collectionName);
      }

      const collection =
        await this.collectionService.getCollection(collectionName);
      const fields = ((
        (collection as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields ||
        (collection as Record<string, unknown>).fields ||
        []) as FieldDefinition[];

      // If targetLabelField is provided, validate it exists in the collection
      if (targetLabelField) {
        const fieldExists = fields.some(
          f => f.name === targetLabelField && f.type !== "relationship"
        );

        if (fieldExists) {
          console.log(
            `[LabelField] Using specified targetLabelField "${targetLabelField}" for collection "${collectionName}"`
          );
          return targetLabelField;
        } else {
          console.warn(
            `[LabelField] Specified targetLabelField "${targetLabelField}" not found in collection "${collectionName}", falling back to auto-detection`
          );
        }
      }

      // Priority order for label fields
      const labelPriority = [
        "name",
        "title",
        "label",
        "email",
        "slug",
        "username",
      ];

      // First try priority fields
      for (const labelField of labelPriority) {
        if (
          fields.some(f => f.name === labelField && f.type !== "relationship")
        ) {
          console.log(
            `[LabelField] Using priority field "${labelField}" for collection "${collectionName}"`
          );
          return labelField;
        }
      }

      // Fallback: find first text-like field (not ID, not relationship).
      const textField = fields.find(
        f =>
          f.name !== "id" &&
          f.type !== "relationship" &&
          (f.type === "text" || f.type === "email")
      );

      if (textField) {
        console.log(
          `[LabelField] Using first text field "${textField.name}" for collection "${collectionName}"`
        );
        return textField.name;
      }

      // Last resort: use id
      console.warn(
        `[LabelField] No suitable label field found for "${collectionName}", falling back to ID`
      );
      return "id";
    } catch (error) {
      console.error(
        `[LabelField] Error getting label field for "${collectionName}":`,
        error
      );
      return "id";
    }
  }

  /**
   * Batch expand relationships for multiple entries (optimized for N+1 prevention).
   * Groups queries by relationship type to minimize database round trips.
   *
   * Supports depth parameter:
   * - depth=0: No expansion, return entries as-is
   * - depth=1+: Expand relationships (note: batch expansion only does 1 level for performance)
   *
   * For deeper nested expansion, use expandRelationships() on individual entries.
   *
   * @param entries - Array of entries to expand
   * @param collectionName - Name of the collection
   * @param fields - Field definitions for the collection
   * @param options - Expansion options including depth control
   * @returns Entries with expanded relationship data
   */
  async batchExpandRelationships(
    entries: Record<string, unknown>[],
    collectionName: string,
    fields: FieldDefinition[],
    options: RelationshipExpansionOptions = {}
  ): Promise<Record<string, unknown>[]> {
    const { depth = DEFAULT_RELATIONSHIP_DEPTH } = options;

    // Clamp depth to valid range
    const effectiveDepth = Math.min(Math.max(depth, 0), MAX_RELATIONSHIP_DEPTH);

    // If depth is 0, don't expand relationships but still normalize
    // repeater/group fields to strip any embedded relationship objects to IDs.
    // This is needed because the save flow may store full relationship objects
    // inside repeater/group JSON data.
    if (effectiveDepth === 0) {
      return entries.map(entry => {
        const normalized = { ...entry };
        for (const field of fields) {
          if (
            (field.type === "repeater" || field.type === "group") &&
            normalized[field.name] != null
          ) {
            const nestedFields = getNestedFields(field);
            if (nestedFields.length === 0) continue;
            const hasNestedRelations = nestedFields.some(
              f =>
                isRelationshipField(f) ||
                f.type === "repeater" ||
                f.type === "group"
            );
            if (!hasNestedRelations) continue;

            const rawData = normalized[field.name];
            const parsed = parseJsonIfString(rawData);

            if (field.type === "repeater" && Array.isArray(parsed)) {
              normalized[field.name] = parsed.map(
                (row: Record<string, unknown>) =>
                  row && typeof row === "object"
                    ? stripRelationshipsToIds(row, nestedFields)
                    : row
              );
            } else if (
              field.type === "group" &&
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              normalized[field.name] = stripRelationshipsToIds(
                parsed as Record<string, unknown>,
                nestedFields
              );
            }
          } else if (isRelationshipField(field)) {
            // Strip top-level relationship fields to IDs too
            const hasMany =
              field.hasMany || field.options?.relationType === "manyToMany";
            const value = normalized[field.name];
            if (value != null) {
              if (hasMany && Array.isArray(value)) {
                normalized[field.name] = value.map((v: unknown) =>
                  extractRelationshipId(v)
                );
              } else {
                normalized[field.name] = extractRelationshipId(value);
              }
            }
          }
        }
        return normalized;
      });
    }

    if (entries.length === 0) return [];

    // Filter for relationship fields.
    const relationFields = fields.filter(f => isRelationshipField(f));

    // Check if there are any fields that could contain media (upload, array, or group)
    // Array and group fields might contain nested upload fields
    const hasMediaFields = fields.some(
      f =>
        isUploadField(f) ||
        isArrayField(f) ||
        isGroupField(f) ||
        isRelationshipField(f)
    );

    // If no relationship fields AND no fields that could contain media, return entries as-is
    if (!hasMediaFields) {
      return entries;
    }

    // Build lookup maps for each relation field
    const relationDataMaps: Record<
      string,
      Map<string, Record<string, unknown> | Record<string, unknown>[]>
    > = {};

    for (const field of relationFields) {
      const relationType = field.options?.relationType || "manyToOne";
      const targetCollection = getTargetCollection(field);
      const hasMany = isHasManyRelationship(field);

      if (!targetCollection) continue;

      // Check field-level maxDepth - if 0, skip this field entirely
      const fieldMaxDepth =
        field.options?.maxDepth ?? field.maxDepth ?? MAX_RELATIONSHIP_DEPTH;
      if (fieldMaxDepth === 0) continue;

      if (relationType === "manyToMany") {
        // Batch fetch all manyToMany relations for all entries
        const entryIds = entries.map(e => e.id) as string[];
        const dataMap = await this.batchFetchManyToManyRelations(
          collectionName,
          entryIds,
          field
        );
        relationDataMaps[field.name] = dataMap;
      } else if (hasMany) {
        // Handle hasMany relationships (arrays of IDs stored directly)
        // Collect all IDs from all entries, handling PostgreSQL array format
        const allRelatedIds: string[] = [];
        for (const entry of entries) {
          const ids = normalizeToIdArray(entry[field.name]);
          allRelatedIds.push(...ids);
        }

        if (allRelatedIds.length > 0) {
          const uniqueIds = [...new Set(allRelatedIds)];
          const dataMap = await this.batchFetchRelatedEntries(
            targetCollection,
            uniqueIds,
            field
          );
          relationDataMaps[field.name] = dataMap;
        } else {
          relationDataMaps[field.name] = new Map();
        }
      } else {
        // Batch fetch all referenced IDs for oneToOne/manyToOne/oneToMany
        const relatedIds = entries
          .map(e => e[field.name])
          .filter(id => id != null) as string[];

        if (relatedIds.length > 0) {
          const dataMap = await this.batchFetchRelatedEntries(
            targetCollection,
            relatedIds,
            field
          );
          relationDataMaps[field.name] = dataMap;
        } else {
          relationDataMaps[field.name] = new Map();
        }
      }
    }

    // ============================================================
    // UPLOAD FIELDS: Batch expand media references (including nested)
    // ============================================================

    // Collect all media IDs from all entries, including nested fields in arrays/groups
    const uploadDataMap: Map<string, Record<string, unknown>> = new Map();
    const allMediaIds: string[] = [];

    for (const entry of entries) {
      // Use recursive function to collect all media IDs at any nesting depth
      const entryMediaIds = collectAllMediaIds(entry, fields);
      allMediaIds.push(...entryMediaIds);
    }

    // Batch fetch all media records at once
    if (allMediaIds.length > 0) {
      const uniqueMediaIds = [...new Set(allMediaIds)];
      const mediaRecords = await this.fetchMediaByIds(uniqueMediaIds);

      // Build lookup map for O(1) access
      for (const media of mediaRecords) {
        uploadDataMap.set(String(media.id), media);
      }
    }

    // Apply the fetched data to each entry
    return Promise.all(
      entries.map(async entry => {
        const expandedEntry = { ...entry };

        for (const field of relationFields) {
          const relationType = field.options?.relationType || "manyToOne";
          const hasMany = isHasManyRelationship(field);
          const dataMap = relationDataMaps[field.name];

          if (!dataMap) continue;

          if (relationType === "manyToMany") {
            expandedEntry[field.name] = dataMap.get(entry.id as string) || [];
          } else if (hasMany) {
            // Handle hasMany relationships - expand array of IDs
            const ids = normalizeToIdArray(entry[field.name]);
            expandedEntry[field.name] = ids
              .map(id => dataMap.get(id))
              .filter(Boolean);
          } else {
            const relatedId = entry[field.name] as string;
            if (relatedId && dataMap.has(relatedId)) {
              expandedEntry[field.name] = dataMap.get(relatedId);
            }
          }
        }

        // Expand relationship fields nested inside repeater/array/group fields
        for (const field of fields) {
          const fieldName = field.name;
          if (
            !fieldName ||
            expandedEntry[fieldName] === undefined ||
            expandedEntry[fieldName] === null
          )
            continue;

          if (isRelationshipField(field)) continue;

          const nestedFields = getNestedFields(field);
          if (nestedFields.length === 0) continue;

          const hasNestedRelations = nestedFields.some(
            f =>
              isRelationshipField(f) ||
              isUploadField(f) ||
              f.type === "repeater" ||
              f.type === "group"
          );
          if (!hasNestedRelations) continue;

          if (field.type === "repeater") {
            const rawData = expandedEntry[fieldName];
            const arrayData = parseJsonIfString(rawData);
            if (Array.isArray(arrayData)) {
              expandedEntry[fieldName] = await Promise.all(
                arrayData.map(async (row: Record<string, unknown>) => {
                  if (row && typeof row === "object") {
                    return this.expandRelationships(
                      row,
                      collectionName,
                      nestedFields,
                      { depth: effectiveDepth, currentDepth: 0 }
                    );
                  }
                  return row;
                })
              );
            }
          } else if (field.type === "group") {
            const rawData = expandedEntry[fieldName];
            const groupData = parseJsonIfString(rawData);
            if (
              groupData &&
              typeof groupData === "object" &&
              !Array.isArray(groupData)
            ) {
              expandedEntry[fieldName] = await this.expandRelationships(
                groupData as Record<string, unknown>,
                collectionName,
                nestedFields,
                { depth: effectiveDepth, currentDepth: 0 }
              );
            }
          }
        }

        // Expand upload fields (media references) - including nested fields in arrays/groups
        // Use recursive function to expand media at any nesting depth
        const fullyExpandedEntry = expandMediaInData(
          expandedEntry,
          fields,
          uploadDataMap
        );

        return fullyExpandedEntry;
      })
    );
  }

  /**
   * Batch fetch related entries for oneToOne/manyToOne/oneToMany relations.
   * Returns a Map of ID -> { id, label }.
   * Uses Drizzle's inArray for clean, type-safe queries.
   *
   * @param targetCollection - Name of the target collection or system entity
   * @param relatedIds - Array of IDs to fetch
   * @param field - Field definition
   * @returns Map of ID to expanded entry data
   */
  async batchFetchRelatedEntries(
    targetCollection: string,
    relatedIds: string[],
    field: FieldDefinition
  ): Promise<Map<string, Record<string, unknown>>> {
    const resultMap = new Map<string, Record<string, unknown>>();

    if (relatedIds.length === 0) return resultMap;

    try {
      // Check if this is a system entity (like "users")
      if (isSystemEntity(targetCollection)) {
        const targetSchema = getSystemEntityTable(targetCollection);
        if (!targetSchema) {
          console.warn(`Unknown system entity: ${targetCollection}`);
          return resultMap;
        }

        const labelField =
          field.options?.targetLabelField ||
          getSystemEntityLabelField(targetCollection);

        // Batch fetch all entries from system entity
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entries = await (this.db as any)
          .select()
          .from(targetSchema)
          .where(inArray(targetSchema.id, relatedIds));

        // Build map for O(1) lookups
        for (const entry of entries) {
          resultMap.set(entry.id, {
            ...entry,
            label: entry[labelField] || entry.id,
          });
        }
      } else {
        // Handle dynamic collections
        const targetSchema =
          await this.fileManager.loadDynamicSchema(targetCollection);
        const labelField = await this.getBestLabelField(
          targetCollection,
          field.options?.targetLabelField
        );

        // Batch fetch all entries using Drizzle's inArray helper
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entries = await (this.db as any)
          .select()
          .from(targetSchema)
          .where(inArray(targetSchema.id, relatedIds));

        // Build map for O(1) lookups — include all fields from the related entry
        for (const entry of entries) {
          resultMap.set(entry.id, {
            ...entry,
            label: entry[labelField] || entry.id,
          });
        }
      }
    } catch (error) {
      console.error(
        `Failed to batch fetch entries for ${targetCollection}:`,
        error
      );
    }

    return resultMap;
  }

  /**
   * Batch fetch manyToMany relations for multiple source entries.
   * Returns a Map of sourceEntryId -> Array<{ id, label }>.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryIds - Array of source entry IDs
   * @param field - Field definition
   * @returns Map of source ID to array of related entries
   */
  async batchFetchManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryIds: string[],
    field: FieldDefinition
  ): Promise<Map<string, Record<string, unknown>[]>> {
    const resultMap = new Map<string, Record<string, unknown>[]>();

    if (sourceEntryIds.length === 0) return resultMap;

    const targetCollectionName = field.options!.target!;
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    try {
      const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
      const targetIdCol = sql.identifier(targetCollectionName + "_id");

      // Batch query junction table for all source entries
      // Build MySQL-compatible IN clause with proper parameterization
      const sourcePlaceholders = sql.join(
        sourceEntryIds.map(id => sql`${id}`),
        sql.raw(", ")
      );

      const junctionQuery = sql`
        SELECT ${sourceIdCol} as source_id, ${targetIdCol} as target_id
        FROM ${sql.identifier(junctionTableName)}
        WHERE ${sourceIdCol} IN (${sourcePlaceholders})
      `;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const junctionResults = await (this.db as any).execute(junctionQuery);

      // Group by source_id
      const groupedRelations: Record<string, string[]> = {};
      for (const row of junctionResults.rows) {
        if (!groupedRelations[row.source_id]) {
          groupedRelations[row.source_id] = [];
        }
        groupedRelations[row.source_id].push(row.target_id);
      }

      // Get all unique target IDs
      const allTargetIds = [...new Set(Object.values(groupedRelations).flat())];

      if (allTargetIds.length === 0) {
        // Initialize empty arrays for all source entries
        for (const sourceId of sourceEntryIds) {
          resultMap.set(sourceId, []);
        }
        return resultMap;
      }

      // Batch fetch all target entries
      const targetSchema =
        await this.fileManager.loadDynamicSchema(targetCollectionName);
      const labelField = await this.getBestLabelField(
        targetCollectionName,
        field.options?.targetLabelField
      );

      console.log(
        `[ManyToMany Expand] Target collection: ${targetCollectionName}, Label field: ${labelField}`
      );

      // Batch fetch all target entries using Drizzle's inArray
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targetEntries = await (this.db as any)
        .select()
        .from(targetSchema)
        .where(inArray(targetSchema.id, allTargetIds));

      console.log(
        `[ManyToMany Expand] Fetched ${targetEntries.length} target entries`
      );
      if (targetEntries.length > 0) {
        console.log(
          `[ManyToMany Expand] Sample entry:`,
          JSON.stringify(targetEntries[0], null, 2)
        );
      }

      // Build target entry map
      const targetEntryMap = new Map(
        targetEntries.map((entry: Record<string, unknown>) => {
          const label = entry[labelField] || entry.id;
          console.log(
            `[ManyToMany Expand] Entry ${entry.id}: labelField="${labelField}", value="${label}"`
          );
          return [entry.id, { ...entry, label }];
        })
      );

      // Map results back to source entries
      for (const sourceId of sourceEntryIds) {
        const targetIds = groupedRelations[sourceId] || [];
        resultMap.set(
          sourceId,
          targetIds.map(id => targetEntryMap.get(id)).filter(Boolean) as Record<
            string,
            unknown
          >[]
        );
      }
    } catch (error) {
      console.error("Failed to batch fetch manyToMany relations:", error);
      // Initialize empty arrays for all source entries on error
      for (const sourceId of sourceEntryIds) {
        resultMap.set(sourceId, []);
      }
    }

    return resultMap;
  }

  /**
   * Expand relationship data for a single entry with depth control.
   *
   * Supports depth parameter:
   * - depth=0: No expansion, return IDs only
   * - depth=1: Expand immediate relationships
   * - depth=2+: Expand nested relationships recursively
   *
   * Also respects field-level `maxDepth` configuration to prevent
   * over-fetching on specific relationship fields.
   *
   * @param entry - Entry to expand
   * @param collectionName - Name of the collection
   * @param fields - Field definitions
   * @param options - Expansion options including depth control
   * @returns Entry with expanded relationship data
   */
  async expandRelationships(
    entry: Record<string, unknown>,
    collectionName: string,
    fields: FieldDefinition[],
    options: RelationshipExpansionOptions = {}
  ): Promise<Record<string, unknown>> {
    const { depth = DEFAULT_RELATIONSHIP_DEPTH, currentDepth = 0 } = options;

    // Clamp depth to valid range
    const effectiveDepth = Math.min(Math.max(depth, 0), MAX_RELATIONSHIP_DEPTH);

    // If we've reached the requested depth, don't expand further
    // but still normalize repeater/group fields to strip embedded relationship objects
    if (currentDepth >= effectiveDepth) {
      return stripRelationshipsToIds(entry, fields);
    }

    const expandedEntry = { ...entry };

    // Filter for relationship fields.
    const relationFields = fields.filter(f => isRelationshipField(f));

    for (const field of relationFields) {
      const relationType = field.options?.relationType || "manyToOne";
      const targetCollection = getTargetCollection(field);
      const hasMany = isHasManyRelationship(field);

      if (!targetCollection || !entry[field.name]) {
        continue;
      }

      // Check field-level maxDepth (from relationship field config)
      // Field maxDepth limits how deep this specific field can be populated
      const fieldMaxDepth =
        field.options?.maxDepth ?? field.maxDepth ?? MAX_RELATIONSHIP_DEPTH;
      if (currentDepth >= fieldMaxDepth) {
        // Don't expand this field, keep the ID(s)
        continue;
      }

      // Get targetLabelField from either options or root level
      const targetLabelField =
        field.options?.targetLabelField ||
        ((field as Record<string, unknown>).targetLabelField as
          | string
          | undefined);

      try {
        if (relationType === "manyToMany") {
          // Fetch related entries through junction table
          const relatedEntries = await this.fetchManyToManyRelations(
            collectionName,
            entry.id as string,
            field
          );

          const labelField = await this.getBestLabelField(
            targetCollection,
            targetLabelField
          );

          // Expand nested relationships if depth allows
          const expandedRelated = await Promise.all(
            relatedEntries.map(async (rel: Record<string, unknown>) => {
              const baseExpanded = {
                id: rel.id,
                label: rel[labelField] || rel.id,
                ...rel, // Include all fields from related entry
              };

              // Recursively expand nested relationships if we have depth remaining
              if (currentDepth + 1 < effectiveDepth) {
                const targetFields =
                  await this.getCollectionFields(targetCollection);
                if (targetFields.length > 0) {
                  return this.expandRelationships(
                    baseExpanded,
                    targetCollection,
                    targetFields,
                    { depth: effectiveDepth, currentDepth: currentDepth + 1 }
                  );
                }
              }
              return baseExpanded;
            })
          );

          expandedEntry[field.name] = expandedRelated;
        } else if (hasMany) {
          // Handle hasMany relationships - array of IDs stored directly
          const ids = normalizeToIdArray(entry[field.name]);

          if (ids.length > 0) {
            const labelField = await this.getBestLabelField(
              targetCollection,
              targetLabelField
            );

            // Fetch all related entries
            const expandedRelated = await Promise.all(
              ids.map(async (id: string) => {
                const relatedEntry = await this.fetchRelatedEntry(
                  targetCollection,
                  id
                );

                if (!relatedEntry) return null;

                let baseExpanded: Record<string, unknown> = {
                  id: relatedEntry.id,
                  label: relatedEntry[labelField] || relatedEntry.id,
                  ...relatedEntry,
                };

                // Recursively expand nested relationships if we have depth remaining
                if (currentDepth + 1 < effectiveDepth) {
                  const targetFields =
                    await this.getCollectionFields(targetCollection);
                  if (targetFields.length > 0) {
                    baseExpanded = await this.expandRelationships(
                      baseExpanded,
                      targetCollection,
                      targetFields,
                      { depth: effectiveDepth, currentDepth: currentDepth + 1 }
                    );
                  }
                }

                return baseExpanded;
              })
            );

            expandedEntry[field.name] = expandedRelated.filter(Boolean);
          } else {
            expandedEntry[field.name] = [];
          }
        } else {
          // oneToOne, manyToOne, oneToMany - already have the ID
          const relatedId = entry[field.name] as string;

          if (relatedId) {
            const relatedEntry = await this.fetchRelatedEntry(
              targetCollection,
              relatedId
            );

            if (relatedEntry) {
              const labelField = await this.getBestLabelField(
                targetCollection,
                targetLabelField
              );

              let expandedRelated: Record<string, unknown> = {
                id: relatedEntry.id,
                label: relatedEntry[labelField] || relatedEntry.id,
                ...relatedEntry, // Include all fields from related entry
              };

              // Recursively expand nested relationships if we have depth remaining
              if (currentDepth + 1 < effectiveDepth) {
                const targetFields =
                  await this.getCollectionFields(targetCollection);
                if (targetFields.length > 0) {
                  expandedRelated = await this.expandRelationships(
                    expandedRelated,
                    targetCollection,
                    targetFields,
                    { depth: effectiveDepth, currentDepth: currentDepth + 1 }
                  );
                }
              }

              expandedEntry[field.name] = expandedRelated;
            }
          }
        }
      } catch (error) {
        // If expansion fails, keep the original value
        console.error(`Failed to expand relation ${field.name}:`, error);
      }
    }

    // Expand relationship fields nested inside repeater/array/group fields
    for (const field of fields) {
      const fieldName = field.name;
      if (
        !fieldName ||
        expandedEntry[fieldName] === undefined ||
        expandedEntry[fieldName] === null
      )
        continue;

      // Skip fields already processed as top-level relationships
      if (isRelationshipField(field)) continue;

      const nestedFields = getNestedFields(field);
      if (nestedFields.length === 0) continue;

      // Only recurse if nested fields contain relationships or further nesting
      const hasNestedRelations = nestedFields.some(
        f =>
          isRelationshipField(f) ||
          isUploadField(f) ||
          f.type === "repeater" ||
          f.type === "group"
      );
      if (!hasNestedRelations) continue;

      if (field.type === "repeater") {
        const rawData = expandedEntry[fieldName];
        const arrayData = parseJsonIfString(rawData);
        if (Array.isArray(arrayData)) {
          expandedEntry[fieldName] = await Promise.all(
            arrayData.map(async (row: Record<string, unknown>) => {
              if (row && typeof row === "object") {
                return this.expandRelationships(
                  row,
                  collectionName,
                  nestedFields,
                  { depth: effectiveDepth, currentDepth }
                );
              }
              return row;
            })
          );
        }
      } else if (field.type === "group") {
        const rawData = expandedEntry[fieldName];
        const groupData = parseJsonIfString(rawData);
        if (
          groupData &&
          typeof groupData === "object" &&
          !Array.isArray(groupData)
        ) {
          expandedEntry[fieldName] = await this.expandRelationships(
            groupData as Record<string, unknown>,
            collectionName,
            nestedFields,
            { depth: effectiveDepth, currentDepth }
          );
        }
      }
    }

    // Expand upload fields (media references) - including nested fields in arrays/groups
    // Collect all media IDs recursively from the entry
    const allMediaIds = collectAllMediaIds(expandedEntry, fields);

    if (allMediaIds.length > 0) {
      try {
        // Batch fetch all media records at once
        const uniqueMediaIds = [...new Set(allMediaIds)];
        const mediaRecords = await this.fetchMediaByIds(uniqueMediaIds);

        // Build lookup map for O(1) access
        const mediaMap = new Map<string, Record<string, unknown>>();
        for (const media of mediaRecords) {
          mediaMap.set(String(media.id), media);
        }

        // Use recursive function to expand media at any nesting depth
        return expandMediaInData(expandedEntry, fields, mediaMap);
      } catch (error) {
        // If expansion fails, keep the original entry
        console.error("Failed to expand upload fields:", error);
      }
    }

    return expandedEntry;
  }

  /**
   * Fetch media records by IDs.
   * Uses the media table to retrieve full media objects.
   *
   * @param ids - Array of media IDs
   * @returns Array of media records
   */
  private async fetchMediaByIds(
    ids: string[]
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];

    try {
      // Resolve the dialect-specific media schema from the adapter's tables.
      // Using Drizzle's typed query builder (rather than raw sql.execute) keeps
      // this dialect-agnostic — better-sqlite3 doesn't expose `.execute()` on
      // Drizzle, and hand-rolled SQL routing per dialect is fragile. The same
      // pattern is used by batchFetchRelatedEntries for the "users" entity.
      const dialect = this.adapter.getCapabilities().dialect;
      const tables = getDialectTables(dialect);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dialect table schemas are dialect-specific Drizzle types
      const mediaTable = (tables as Record<string, any>).media;

      if (!mediaTable) {
        console.warn(
          `[fetchMediaByIds] Media table schema not registered for dialect ${dialect}`
        );
        return [];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle builder returns dialect-specific types
      const rows = (await (this.db as any)
        .select()
        .from(mediaTable)
        .where(inArray(mediaTable.id, ids))) as Record<string, unknown>[];

      // Recursively convert snake_case fields to camelCase for API response
      // Database may return snake_case columns (thumbnail_url, mime_type, etc.)
      // This handles nested objects and arrays within media records
      return rows.map(row => keysToCamelCase(row) as Record<string, unknown>);
    } catch (error) {
      console.error("Failed to fetch media by IDs:", error);
      return [];
    }
  }

  /**
   * Get field definitions for a collection.
   * Helper method for recursive relationship expansion.
   *
   * @param collectionName - Name of the collection
   * @returns Field definitions or empty array if not found
   */
  private async getCollectionFields(
    collectionName: string
  ): Promise<FieldDefinition[]> {
    try {
      // System entities don't have field definitions
      if (isSystemEntity(collectionName)) {
        return [];
      }

      const collection =
        await this.collectionService.getCollection(collectionName);
      return ((
        (collection as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields || []) as FieldDefinition[];
    } catch {
      return [];
    }
  }

  /**
   * Fetch a single related entry from a collection or system entity.
   * Supports both dynamic collections and system entities (like "users").
   *
   * @param collectionName - Name of the collection or system entity
   * @param entryId - ID of the entry to fetch
   * @returns The entry or null if not found
   */
  async fetchRelatedEntry(
    collectionName: string,
    entryId: string
  ): Promise<Record<string, unknown> | null> {
    try {
      // Check if this is a system entity (like "users")
      if (isSystemEntity(collectionName)) {
        const targetSchema = getSystemEntityTable(collectionName);
        if (!targetSchema) {
          return null;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [entry] = await (this.db as any)
          .select()
          .from(targetSchema)
          .where(eq(targetSchema.id, entryId))
          .limit(1);

        return entry || null;
      } else {
        // Handle dynamic collections
        const schema = await this.fileManager.loadDynamicSchema(collectionName);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [entry] = await (this.db as any)
          .select()
          .from(schema)
          .where(eq(schema.id, entryId))
          .limit(1);

        return entry || null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Fetch many-to-many related entries.
   * Optimized with MySQL-compatible IN clause.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   * @returns Array of related entries
   */
  async fetchManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition
  ): Promise<Record<string, unknown>[]> {
    const targetCollectionName = field.options!.target!;
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    try {
      // Query junction table to get related IDs using sql tagged template
      const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
      const targetIdCol = sql.identifier(targetCollectionName + "_id");

      const junctionQuery = sql`
        SELECT ${targetIdCol} as target_id
        FROM ${sql.identifier(junctionTableName)}
        WHERE ${sourceIdCol} = ${sourceEntryId}
      `;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const junctionResults = await (this.db as any).execute(junctionQuery);
      const relatedIds = junctionResults.rows.map(
        (row: Record<string, unknown>) => row.target_id
      );

      if (relatedIds.length === 0) {
        return [];
      }

      // Fetch the actual entries using MySQL-compatible IN clause
      const targetSchema =
        await this.fileManager.loadDynamicSchema(targetCollectionName);

      // Build IN clause with parameterized values for MySQL compatibility
      const placeholders = sql.join(
        relatedIds.map((id: string) => sql`${id}`),
        sql.raw(", ")
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await (this.db as any)
        .select()
        .from(targetSchema)
        .where(sql`${targetSchema.id} IN (${placeholders})`);

      return entries || [];
    } catch (error) {
      console.error("Failed to fetch many-to-many relations:", error);
      return [];
    }
  }

  /**
   * Insert many-to-many relationships into junction table.
   * Uses individual inserts for reliability (still fast with proper indexing).
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   * @param relatedIds - Array of related entry IDs to link
   */
  async insertManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition,
    relatedIds: string[]
  ): Promise<void> {
    if (relatedIds.length === 0) return;

    const targetCollectionName = field.options!.target!;
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    console.log(
      `[ManyToMany] Inserting into junction table: ${junctionTableName}`
    );
    console.log(
      `[ManyToMany] Source: ${sourceCollectionName}, Target: ${targetCollectionName}`
    );
    console.log(
      `[ManyToMany] Field: ${field.name}, IDs: ${relatedIds.join(", ")}`
    );

    // Check if junction table exists
    try {
      const checkQuery = sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = ${junctionTableName}
        ) as exists
      `;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any).execute(checkQuery);
      const exists = result.rows[0]?.exists;

      if (!exists) {
        throw new Error(
          `Junction table "${junctionTableName}" does not exist. ` +
            `Did you restart the app after creating the manyToMany field? ` +
            `Check migration files in src/db/migrations/dynamic/`
        );
      }
      console.log(`[ManyToMany] ✓ Junction table exists: ${junctionTableName}`);
    } catch (error: unknown) {
      console.error(`[ManyToMany] Junction table check failed:`, error);
      throw error;
    }

    const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
    const targetIdCol = sql.identifier(targetCollectionName + "_id");

    // Track errors
    const errors: string[] = [];

    // Insert each relationship individually for reliability
    // Modern databases handle this efficiently with proper indexes
    for (const targetId of relatedIds) {
      try {
        const id = this.collectionService.generateId();
        const now = new Date();

        const query = sql`
          INSERT INTO ${sql.identifier(junctionTableName)}
          (id, ${sourceIdCol}, ${targetIdCol}, created_at)
          VALUES (${id}, ${sourceEntryId}, ${targetId}, ${now})
          ON CONFLICT DO NOTHING
        `;

        console.log(`[ManyToMany] Executing insert for targetId: ${targetId}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.db as any).execute(query);
        console.log(
          `[ManyToMany] ✓ Insert successful for targetId: ${targetId}`
        );
      } catch (error: unknown) {
        const errorMsg = `Failed to insert junction record for ${targetId}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[ManyToMany] ✗ ${errorMsg}`);
        console.error(`[ManyToMany] Full error:`, error);
        errors.push(errorMsg);
      }
    }

    // If all inserts failed, throw error
    if (errors.length === relatedIds.length && relatedIds.length > 0) {
      throw new Error(
        `Failed to insert all manyToMany relations for field "${field.name}". Errors: ${errors.join("; ")}`
      );
    }

    // If some failed, log warning
    if (errors.length > 0) {
      console.warn(
        `[ManyToMany] Partial failure: ${errors.length}/${relatedIds.length} inserts failed`
      );
    }
  }

  /**
   * Delete many-to-many relationships from junction table.
   * Uses Drizzle's sql tagged template for type safety and MySQL compatibility.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   */
  async deleteManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition
  ): Promise<void> {
    const targetCollectionName = field.options!.target!;
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
    const query = sql`
      DELETE FROM ${sql.identifier(junctionTableName)}
      WHERE ${sourceIdCol} = ${sourceEntryId}
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any).execute(query);
  }

  /**
   * Get junction table name for many-to-many relationship.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param targetCollectionName - Name of the target collection
   * @param field - Field definition
   * @returns Junction table name
   */
  getJunctionTableName(
    sourceCollectionName: string,
    targetCollectionName: string,
    field: FieldDefinition
  ): string {
    if (field.options?.junctionTable) {
      return field.options.junctionTable;
    }

    // Auto-generate junction table name (same logic as in dynamic-collections.ts)
    const sourceTableName = `dc_${sourceCollectionName}`;
    const targetTableName = `dc_${targetCollectionName}`;
    const tables = [sourceTableName, targetTableName].sort();
    return `${tables[0]}_${tables[1]}_${field.name}`;
  }
}
