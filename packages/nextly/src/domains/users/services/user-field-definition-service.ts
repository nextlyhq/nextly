/**
 * User Field Definition Service
 *
 * CRUD operations for managing user field definitions stored in the
 * `user_field_definitions` table. Supports both UI-sourced fields
 * (fully editable in admin) and code-sourced fields (synced from
 * `defineConfig()`, read-only in admin).
 *
 * Write operations (`updateField`, `deleteField`) reject code-sourced
 * fields with a business rule error — code fields should be modified
 * in `defineConfig()` instead.
 *
 * @module services/users/user-field-definition-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq, and, desc, asc, inArray } from "drizzle-orm";

import { ServiceError } from "../../../errors/service-error";
import { userFieldDefinitionsMysql } from "../../../schemas/user-field-definitions/mysql";
import { userFieldDefinitionsPg } from "../../../schemas/user-field-definitions/postgres";
import { userFieldDefinitionsSqlite } from "../../../schemas/user-field-definitions/sqlite";
import type {
  UserFieldDefinitionInsert,
  UserFieldDefinitionRecord,
} from "../../../schemas/user-field-definitions/types";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

// ============================================================
// Drizzle Transaction Type
// ============================================================

/**
 * Minimal interface for the Drizzle transaction object returned by
 * BaseService.withTransaction. The real type is dialect-specific
 * (NodePgTransaction / MySql2Transaction / BetterSQLite3Database),
 * but the fluent query API is identical across all three.
 */
interface DrizzleTransactionLike {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

// ============================================================
// Input Types
// ============================================================

/**
 * Input for creating a new user field definition.
 * Extends UserFieldDefinitionInsert (all required + optional fields).
 */
export type CreateUserFieldDefinitionInput = UserFieldDefinitionInsert;

/**
 * Input for updating an existing user field definition.
 * All fields are optional — only provided fields are updated.
 * Note: `source` cannot be changed after creation.
 */
export interface UpdateUserFieldDefinitionInput {
  name?: string;
  label?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | null;
  options?: { label: string; value: string }[] | null;
  placeholder?: string | null;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

// ============================================================
// User Field Definition Service
// ============================================================

/** Union of all dialect-specific user_field_definitions table types */
type UserFieldDefinitionsTable =
  | typeof userFieldDefinitionsPg
  | typeof userFieldDefinitionsMysql
  | typeof userFieldDefinitionsSqlite;

export class UserFieldDefinitionService extends BaseService {
  /** Dialect-specific Drizzle table for user_field_definitions (resolved at construction) */
  private userFieldDefinitions: UserFieldDefinitionsTable;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    switch (this.dialect) {
      case "postgresql":
        this.userFieldDefinitions = userFieldDefinitionsPg;
        break;
      case "mysql":
        this.userFieldDefinitions = userFieldDefinitionsMysql;
        break;
      case "sqlite":
        this.userFieldDefinitions = userFieldDefinitionsSqlite;
        break;
      default:
        throw new Error(`Unsupported dialect: ${this.dialect}`);
    }
  }

  // ============================================================
  // CRUD Methods
  // ============================================================

  /**
   * Create a new user field definition.
   *
   * If `sortOrder` is not provided, it defaults to one higher than
   * the current maximum sort order (appending to the end).
   *
   * @throws ServiceError DATABASE_ERROR on unique constraint violation (duplicate name)
   */
  async createField(
    data: CreateUserFieldDefinitionInput
  ): Promise<UserFieldDefinitionRecord> {
    const id = randomUUID();
    const now = new Date();

    // Auto-assign sortOrder if not provided
    let sortOrder = data.sortOrder;
    if (sortOrder === undefined || sortOrder === null) {
      sortOrder = await this.getNextSortOrder();
    }

    const values = {
      id,
      name: data.name,
      label: data.label,
      type: data.type,
      required: data.required ?? false,
      defaultValue: data.defaultValue ?? null,
      options: data.options ?? null,
      placeholder: data.placeholder ?? null,
      description: data.description ?? null,
      sortOrder,
      source: data.source ?? "ui",
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.db.insert(this.userFieldDefinitions).values(values);
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }

    return this.getField(id);
  }

  /**
   * Get a single user field definition by ID.
   *
   * @throws ServiceError NOT_FOUND if field definition doesn't exist
   */
  async getField(id: string): Promise<UserFieldDefinitionRecord> {
    const results = await this.db
      .select()
      .from(this.userFieldDefinitions)
      .where(eq(this.userFieldDefinitions.id, id))
      .limit(1);

    if (results.length === 0) {
      throw ServiceError.notFound("User field definition not found", { id });
    }

    return results[0] as UserFieldDefinitionRecord;
  }

  /**
   * List all user field definitions, ordered by sort order (ascending),
   * then by creation date (ascending) as a tiebreaker.
   */
  async listFields(): Promise<UserFieldDefinitionRecord[]> {
    const results = await this.db
      .select()
      .from(this.userFieldDefinitions)
      .orderBy(
        asc(this.userFieldDefinitions.sortOrder),
        asc(this.userFieldDefinitions.createdAt)
      );

    return results as UserFieldDefinitionRecord[];
  }

  /**
   * Update an existing user field definition.
   *
   * Only UI-sourced fields can be updated. Code-sourced fields
   * must be modified in `defineConfig()`.
   *
   * Note: `source` cannot be changed after creation, but `name` can be updated.
   *
   * @throws ServiceError NOT_FOUND if field definition doesn't exist
   * @throws ServiceError BUSINESS_RULE_VIOLATION if field is code-sourced
   */
  async updateField(
    id: string,
    data: UpdateUserFieldDefinitionInput
  ): Promise<UserFieldDefinitionRecord> {
    const existing = await this.getField(id);

    if (existing.source === "code") {
      throw ServiceError.businessRule(
        "Cannot update code-sourced field definitions. Modify defineConfig() instead.",
        { id, name: existing.name }
      );
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.label !== undefined) updateData.label = data.label;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.required !== undefined) updateData.required = data.required;
    if (data.defaultValue !== undefined)
      updateData.defaultValue = data.defaultValue;
    if (data.options !== undefined) updateData.options = data.options;
    if (data.placeholder !== undefined)
      updateData.placeholder = data.placeholder;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    try {
      await this.db
        .update(this.userFieldDefinitions)
        .set(updateData)
        .where(eq(this.userFieldDefinitions.id, id));
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }

    return this.getField(id);
  }

  /**
   * Delete a user field definition.
   *
   * Only UI-sourced fields can be deleted. Code-sourced fields
   * must be removed from `defineConfig()`.
   *
   * @throws ServiceError NOT_FOUND if field definition doesn't exist
   * @throws ServiceError BUSINESS_RULE_VIOLATION if field is code-sourced
   */
  async deleteField(id: string): Promise<void> {
    const existing = await this.getField(id);

    if (existing.source === "code") {
      throw ServiceError.businessRule(
        "Cannot delete code-sourced field definitions. Remove from defineConfig() instead.",
        { id, name: existing.name }
      );
    }

    await this.db
      .delete(this.userFieldDefinitions)
      .where(eq(this.userFieldDefinitions.id, id));
  }

  /**
   * Reorder field definitions by updating `sortOrder` based on
   * the position of each field ID in the provided array.
   *
   * Field IDs not in the array keep their current sort order.
   * Uses a transaction for atomicity.
   *
   * @param fieldIds - Array of field IDs in the desired order
   * @returns Updated list of all field definitions
   */
  async reorderFields(
    fieldIds: string[]
  ): Promise<UserFieldDefinitionRecord[]> {
    const now = new Date();

    await this.withTransaction(async tx => {
      // tx is unknown from BaseService.withTransaction — cast to access Drizzle fluent API
      const txDb = tx as DrizzleTransactionLike;
      for (let i = 0; i < fieldIds.length; i++) {
        await txDb
          .update(this.userFieldDefinitions)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(this.userFieldDefinitions.id, fieldIds[i]));
      }
    });

    return this.listFields();
  }

  // ============================================================
  // Code Field Sync (Subtask 5.10.2)
  // ============================================================

  /**
   * Sync code-defined fields from `defineConfig()` into the
   * `user_field_definitions` table.
   *
   * - Upserts code fields with `source = 'code'`
   * - Deletes stale `source = 'code'` rows no longer in config
   * - Code fields get `sortOrder` based on array index (0, 1, 2...)
   * - Called on startup (`nextly dev` / `nextly start`)
   * - Idempotent — safe to run on every startup
   *
   * @param codeFields - Fields from `defineConfig().users.fields`
   */
  async syncCodeFields(
    codeFields: { name: string; [key: string]: unknown }[]
  ): Promise<void> {
    if (!codeFields || codeFields.length === 0) {
      // No code fields — delete any stale code-sourced rows
      await this.db
        .delete(this.userFieldDefinitions)
        .where(eq(this.userFieldDefinitions.source, "code"));
      return;
    }

    // Fetch all existing code-sourced field definitions
    const existingCodeFields: UserFieldDefinitionRecord[] = await this.db
      .select()
      .from(this.userFieldDefinitions)
      .where(eq(this.userFieldDefinitions.source, "code"));

    const existingByName = new Map(existingCodeFields.map(f => [f.name, f]));
    const incomingNames = new Set(codeFields.map(f => f.name));

    await this.withTransaction(async tx => {
      // tx is unknown from BaseService.withTransaction — cast to access Drizzle fluent API
      const txDb = tx as DrizzleTransactionLike;
      const now = new Date();

      // Upsert each code field
      for (let i = 0; i < codeFields.length; i++) {
        const field = codeFields[i];
        const name = field.name as string;
        const label = (field.label as string) || name;
        const type = (field.type as string) || "text";
        const required = (field.required as boolean) ?? false;
        const defaultValue = (field.defaultValue as string) ?? null;
        const options =
          (field.options as { label: string; value: string }[]) ?? null;
        const placeholder = (field.placeholder as string) ?? null;
        const description = (field.description as string) ?? null;
        const sortOrder = i;

        const existing = existingByName.get(name);

        if (existing) {
          // Update if any property changed
          const changed =
            existing.label !== label ||
            existing.type !== type ||
            existing.required !== required ||
            existing.defaultValue !== defaultValue ||
            JSON.stringify(existing.options) !== JSON.stringify(options) ||
            existing.placeholder !== placeholder ||
            existing.description !== description ||
            existing.sortOrder !== sortOrder;

          if (changed) {
            await txDb
              .update(this.userFieldDefinitions)
              .set({
                label,
                type,
                required,
                defaultValue,
                options,
                placeholder,
                description,
                sortOrder,
                updatedAt: now,
              })
              .where(eq(this.userFieldDefinitions.id, existing.id));
          }
        } else {
          // Insert new code field
          await txDb.insert(this.userFieldDefinitions).values({
            id: randomUUID(),
            name,
            label,
            type,
            required,
            defaultValue,
            options,
            placeholder,
            description,
            sortOrder,
            source: "code",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // Delete stale code fields (in DB but not in config)
      const staleIds = existingCodeFields
        .filter(f => !incomingNames.has(f.name))
        .map(f => f.id);

      if (staleIds.length > 0) {
        await txDb
          .delete(this.userFieldDefinitions)
          .where(
            and(
              eq(this.userFieldDefinitions.source, "code"),
              inArray(this.userFieldDefinitions.id, staleIds)
            )
          );
      }
    });
  }

  /**
   * Get merged field list (code + UI) for schema generation.
   *
   * Returns all active field definitions ordered by sort order,
   * combining both code-synced and UI-created fields.
   */
  async getMergedFields(): Promise<UserFieldDefinitionRecord[]> {
    const results = await this.db
      .select()
      .from(this.userFieldDefinitions)
      .where(eq(this.userFieldDefinitions.isActive, true))
      .orderBy(
        asc(this.userFieldDefinitions.sortOrder),
        asc(this.userFieldDefinitions.createdAt)
      );

    return results as UserFieldDefinitionRecord[];
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Get the next available sort order value (max + 1).
   * Returns 0 if no fields exist.
   */
  private async getNextSortOrder(): Promise<number> {
    const results = await this.db
      .select()
      .from(this.userFieldDefinitions)
      .orderBy(desc(this.userFieldDefinitions.sortOrder))
      .limit(1);

    if (results.length === 0) return 0;
    return ((results[0] as UserFieldDefinitionRecord).sortOrder ?? 0) + 1;
  }
}
