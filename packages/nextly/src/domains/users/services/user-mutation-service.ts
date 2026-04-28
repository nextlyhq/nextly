/**
 * UserMutationService - Write operations for users
 *
 * Handles user creation, updates, and deletion with validation,
 * role assignment, and email service integration.
 *
 * This service uses the database adapter pattern for multi-database support
 * (PostgreSQL, MySQL, SQLite). For complex queries, it uses direct Drizzle
 * access via the compatibility layer until the adapter is enhanced.
 *
 * @example
 * ```typescript
 * const mutationService = new UserMutationService(adapter, logger);
 *
 * const newUser = await mutationService.createLocalUser({ email: 'user@example.com', name: 'John' });
 * await mutationService.updateUser(userId, { name: 'Jane' });
 * await mutationService.deleteUser(userId);
 * ```
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Table, Column } from "drizzle-orm";
import { eq } from "drizzle-orm";

import { hashPassword } from "@nextly/auth/password";
import { CreateLocalUserSchema, UpdateUserSchema } from "@nextly/schemas/user";
import {
  buildCreateUserSchema,
  buildUpdateUserSchema,
} from "@nextly/schemas/user-fields";
import type { MinimalUser } from "@nextly/types/auth";
import type {
  UserInsertData,
  UserUpdateData,
} from "@nextly/types/database-operations";

// PR 4 of unified-error-system migration: ServiceError result-shapes →
// NextlyError throws. Methods now return data directly or throw.
import { isDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { BaseService } from "../../../services/base-service";
import type { EmailService } from "../../../services/email/email-service";
import { ServiceContainer } from "../../../services/index";
import type { Logger } from "../../../services/shared";
import type { UserConfig, UserFieldConfig } from "../../../users/config/types";

import type { UserExtSchemaService } from "./user-ext-schema-service";

// ============================================================
// Drizzle Runtime Types
// ============================================================

/**
 * Runtime-generated Drizzle table object (e.g., from `pgTable()` / `mysqlTable()` / `sqliteTable()`).
 * The exact type depends on the dialect; property access (e.g., `table.user_id`) is needed,
 * so we use `Record<string, unknown>` with an intersection of `Table` for Drizzle API compat.
 */
type DrizzleRuntimeTable = Table & Record<string, unknown>;

/**
 * Lint-safe replacement for the unsafe built-in `Function` type used as a
 * callable property holder. The Drizzle query builder methods we access
 * (insert/update/delete/...) return chainable thenables whose static types
 * we deliberately drop. The method type returns the same chainable shape
 * so dot-chaining keeps typing, and awaits resolve to
 * `Record<string, unknown>[]` (a row list) since that is the only shape
 * we ever consume here.
 */
interface DrizzleChain {
  [key: string]: DrizzleChainMethod;
}
type DrizzleChainMethod = (
  ...args: unknown[]
) => DrizzleChain & PromiseLike<Record<string, unknown>[]>;

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

/**
 * Data for creating a new local user.
 * Index signature allows custom field values from UserConfig.fields to pass through.
 */
export interface CreateLocalUserData {
  email: string;
  name: string;
  image?: string | null;
  password?: string | null;
  roles?: string[];
  isActive?: boolean;
  sendWelcomeEmail?: boolean;
  /** Custom field values from user_ext */
  [key: string]: unknown;
}

/**
 * Data for updating an existing user.
 * Index signature allows custom field values from UserConfig.fields to pass through.
 */
export interface UpdateUserData {
  email?: string;
  name?: string;
  image?: string;
  password?: string | null;
  emailVerified?: Date | null;
  roles?: string[];
  isActive?: boolean;
  sendWelcomeEmail?: boolean;
  /** Custom field values from user_ext */
  [key: string]: unknown;
}

/**
 * Response type for user mutation operations.
 *
 * Post-migration (PR 4): no `success`/`statusCode`/`message` envelope —
 * methods return the user directly on success or throw NextlyError.
 */
export type UserMutationResponse = MinimalUser;

export class UserMutationService extends BaseService {
  private readonly userConfig?: UserConfig;
  private readonly userExtSchemaService?: UserExtSchemaService;

  /** Last known merged field count — used to detect stale caches */
  private lastMergedFieldCount = -1;

  /** Cached runtime Drizzle table object for user_ext (regenerated when fields change) */
  private userExtTable: DrizzleRuntimeTable | null = null;

  /** Cached set of custom field names for quick lookup (regenerated when fields change) */
  private customFieldNames: Set<string> | null = null;

  /** Set to true when a user_ext query fails (table missing), disabling ext operations */
  private userExtDisabled = false;

  /** Cached merged Zod schemas (lazy, rebuilt when merged fields are available) */
  private createSchema: typeof CreateLocalUserSchema;
  private updateSchema: typeof UpdateUserSchema;
  private schemasBuiltWithMerged = false;

  /**
   * Creates a new UserMutationService instance.
   *
   * @param adapter - Database adapter for multi-database support
   * @param logger - Logger instance
   * @param userConfig - Optional user extension configuration
   * @param userExtSchemaService - Optional schema service for generating runtime user_ext table
   * @param emailService - Optional email service for sending welcome emails
   */
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    userConfig?: UserConfig,
    userExtSchemaService?: UserExtSchemaService,
    emailService?: EmailService
  ) {
    super(adapter, logger);

    this.userConfig = userConfig;
    this.userExtSchemaService = userExtSchemaService;
    this.emailService = emailService;

    // Build merged Zod schemas when custom fields are configured
    if (userConfig?.fields && userConfig.fields.length > 0) {
      this.createSchema = buildCreateUserSchema(userConfig.fields);
      this.updateSchema = buildUpdateUserSchema(userConfig.fields);
    } else {
      this.createSchema = CreateLocalUserSchema;
      this.updateSchema = UpdateUserSchema;
    }
  }

  // ============================================================
  // User Extension Helpers
  // ============================================================

  /**
   * Get the effective custom fields for this service.
   *
   * Prefers merged fields from `UserExtSchemaService` (code + UI sources,
   * loaded via `loadMergedFields()` at startup) and falls back to
   * `userConfig.fields` (code-only from `defineConfig()`).
   */
  private getEffectiveFields(): UserFieldConfig[] {
    if (this.userExtSchemaService?.hasMergedFields()) {
      return this.userExtSchemaService.getMergedFieldConfigs();
    }
    return this.userConfig?.fields ?? [];
  }

  /**
   * Check if custom user fields are configured (from either source).
   */
  private hasCustomFields(): boolean {
    return this.getEffectiveFields().length > 0;
  }

  /**
   * Check if cached ext data is stale (merged fields changed since last cache).
   * If stale, clear caches so they are regenerated on next access.
   */
  private ensureCachesFresh(): void {
    const currentCount = this.getEffectiveFields().length;
    if (currentCount !== this.lastMergedFieldCount) {
      this.userExtTable = null;
      this.customFieldNames = null;
      this.schemasBuiltWithMerged = false;
      this.userExtDisabled = false;
      this.lastMergedFieldCount = currentCount;
    }
  }

  /**
   * Get or lazily create the runtime Drizzle table object for user_ext.
   * Automatically invalidated when merged fields change.
   */
  private getUserExtTable(): DrizzleRuntimeTable | null {
    this.ensureCachesFresh();
    if (this.userExtDisabled) return null;
    if (this.userExtTable) return this.userExtTable;
    if (!this.hasCustomFields() || !this.userExtSchemaService) return null;

    this.userExtTable = this.userExtSchemaService.generateRuntimeSchema(
      this.getEffectiveFields()
    );
    return this.userExtTable;
  }

  /**
   * Get the set of custom field names for quick lookup.
   * Automatically invalidated when merged fields change.
   */
  private getCustomFieldNames(): Set<string> {
    this.ensureCachesFresh();
    if (this.customFieldNames) return this.customFieldNames;

    this.customFieldNames = new Set<string>();
    for (const field of this.getEffectiveFields()) {
      if ("name" in field && field.name) {
        this.customFieldNames.add(field.name);
      }
    }
    return this.customFieldNames;
  }

  /**
   * Get the Zod create schema, rebuilding with merged fields if needed.
   */
  private getCreateSchema(): typeof CreateLocalUserSchema {
    this.ensureSchemasUpToDate();
    return this.createSchema;
  }

  /**
   * Get the Zod update schema, rebuilding with merged fields if needed.
   */
  private getUpdateSchema(): typeof UpdateUserSchema {
    this.ensureSchemasUpToDate();
    return this.updateSchema;
  }

  /**
   * Rebuild Zod validation schemas if merged fields are available
   * and haven't been incorporated yet.
   */
  private ensureSchemasUpToDate(): void {
    if (this.schemasBuiltWithMerged) return;
    if (!this.userExtSchemaService?.hasMergedFields()) return;

    const fields = this.getEffectiveFields();
    if (fields.length > 0) {
      this.createSchema = buildCreateUserSchema(fields);
      this.updateSchema = buildUpdateUserSchema(fields);
    }
    this.schemasBuiltWithMerged = true;
  }

  /**
   * Extract custom field values from input data.
   * Returns an object with only the keys that match configured custom field names.
   * Values are included even if null/undefined (to ensure user_ext row has all columns).
   */
  private extractCustomFieldValues(
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const fieldNames = this.getCustomFieldNames();

    for (const fieldName of fieldNames) {
      if (fieldName in input) {
        values[fieldName] = input[fieldName] ?? null;
      } else {
        values[fieldName] = null;
      }
    }
    return values;
  }

  private readonly emailService?: EmailService;

  /**
   * Create a new local user with password authentication.
   *
   * §13.8 + spec note: "User with this email already exists" is sensitive
   * (account enumeration) and now surfaces as a generic
   * NextlyError.duplicate(). Validation errors carry per-field paths but
   * never echo values; identifiers go to logContext.
   *
   * @throws NextlyError(VALIDATION_ERROR) on input validation / invalid role ids.
   * @throws NextlyError(DUPLICATE) when the email is already registered.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async createLocalUser(
    userData: CreateLocalUserData
  ): Promise<UserMutationResponse> {
    try {
      // Determine if this is the very first user in the database (existence check)
      const isFirstUser = await this.db.query.users.findFirst({
        columns: { id: true },
      });

      // Validate input (merged schema includes custom field validators when configured)
      const validation = this.getCreateSchema().safeParse(userData);
      if (!validation.success) {
        throw NextlyError.validation({
          errors: validation.error.issues.map(i => ({
            path: i.path.join(".") || "input",
            code: i.code.toUpperCase(),
            message: i.message,
          })),
          // Email goes to logContext only — never echoed in the public message.
          logContext: { entity: "user", email: userData.email },
        });
      }

      // Derive password hash once (supports pre-hashed inputs while prioritizing plain passwords)
      let passwordHash: string | null = null;
      if (userData.password && userData.password.length > 0) {
        const looksPlain =
          userData.password.length < 32 || !userData.password.includes(":");
        passwordHash = looksPlain
          ? await hashPassword(userData.password)
          : userData.password;
      }

      const { users } = this.tables;

      // Check existing. Account-enumeration sensitive: the public message
      // stays generic ("Resource already exists.") via NextlyError.duplicate;
      // the email + entity flow only through logContext.
      const existingUser = await this.db.query.users.findFirst({
        where: eq(users.email, userData.email),
        columns: { id: true, email: true },
      });
      if (existingUser) {
        throw NextlyError.duplicate({
          logContext: { entity: "user", email: userData.email },
        });
      }

      // If roles are provided, validate they all exist before creating the user.
      // Post-migration: services.roles.getRoleById throws NextlyError(NOT_FOUND)
      // when missing rather than returning {success, data} — catch and treat
      // any thrown error as "role not found" so we batch them into one
      // VALIDATION_ERROR for the caller.
      if (userData.roles && userData.roles.length > 0) {
        const uniqueRoleIds = Array.from(new Set(userData.roles));
        const services = new ServiceContainer(this.adapter);
        const invalidRoleIds: string[] = [];
        for (const rid of uniqueRoleIds) {
          try {
            await services.roles.getRoleById(rid);
          } catch {
            invalidRoleIds.push(rid);
          }
        }
        if (invalidRoleIds.length > 0) {
          // §13.8: per-error message names the field (`roles`) but not the
          // bad values; the invalid ids go to logContext.
          throw NextlyError.validation({
            errors: [
              {
                path: "roles",
                code: "INVALID_ROLE_ID",
                message: "One or more role ids are invalid.",
              },
            ],
            logContext: { invalidRoleIds },
          });
        }
      }

      // Insert new user (and user_ext if custom fields are configured)
      const now = new Date();
      const newUserId = randomUUID();
      const values: UserInsertData = {
        id: newUserId,
        email: userData.email,
        name: userData.name,
        passwordHash,
        // Auto-verify email unless sendWelcomeEmail is checked (requires user to confirm)
        emailVerified: userData.sendWelcomeEmail ? null : now,
        image: userData.image ?? null,
        isActive: userData.isActive ?? false,
        createdAt: now,
        updatedAt: now,
      };

      // Extract custom field values before the transaction
      const hasExt = this.hasCustomFields();
      const userExtTable = hasExt ? this.getUserExtTable() : null;
      let customFieldValues: Record<string, unknown> = {};
      if (hasExt) {
        customFieldValues = this.extractCustomFieldValues(userData);
      }

      // Wrap user + user_ext inserts in a transaction for atomicity.
      // tx is a Drizzle transaction (NodePgTransaction / MySql2Transaction /
      // BetterSQLite3Transaction depending on dialect) that exposes the same
      // fluent query API as this.db. See BaseService.withTransaction.
      try {
        await this.withTransaction(async tx => {
          const txDb = tx as DrizzleTransactionLike;
          await txDb.insert(users).values(values);

          // Always create a user_ext row when custom fields are configured
          if (hasExt && userExtTable) {
            await txDb.insert(userExtTable).values({
              id: randomUUID(),
              user_id: newUserId,
              ...customFieldValues,
              created_at: now,
              updated_at: now,
            });
          }
        });
      } catch (txErr) {
        // Self-healing: if user_ext is configured but the user_ext insert blew
        // up (typical on a fresh DB before the user_ext table is created), log
        // the cause, disable user_ext for the rest of this process, and retry
        // the user insert alone so the caller still gets a created user. If
        // user_ext is NOT configured, the failure is unrelated to the schema
        // drift and must propagate.
        if (hasExt && userExtTable) {
          const cause = txErr instanceof Error ? txErr.message : String(txErr);
          this.logger.warn(
            `user_ext insert failed during createLocalUser; disabling user_ext for this process: ${cause}`
          );
          this.userExtDisabled = true;
          await this.withTransaction(async tx => {
            const txDb = tx as DrizzleTransactionLike;
            await txDb.insert(users).values(values);
          });
        } else {
          throw txErr;
        }
      }

      // Fetch created user
      const user = await this.db.query.users.findFirst({
        where: eq(users.email, userData.email),
        columns: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!user) {
        // We just inserted; if we cannot read the row back, something is
        // genuinely wrong with the connection or the schema. Surface as an
        // internal error with the email captured in logContext.
        throw NextlyError.internal({
          logContext: {
            reason: "post-insert-readback-missing",
            email: userData.email,
          },
        });
      }

      // 🔹 If this is the first user ever, ensure super-admin exists and assign it
      if (!isFirstUser) {
        const services = new ServiceContainer(this.adapter);
        const { id: superAdminRoleId } =
          await services.roles.ensureSuperAdminRole();

        await services.userRoles
          .assignRoleToUser(user.id, superAdminRoleId)
          .catch(error => {
            console.error(
              `Failed to assign super admin role to user with ID ${user.id}:`,
              error
            );
          });
      }

      // 🔹 Assign roles if provided
      if (userData.roles && userData.roles.length > 0) {
        const services = new ServiceContainer(this.adapter);
        for (const rid of userData.roles) {
          await services.userRoles
            .assignRoleToUser(String(user.id), rid)
            .catch(() => undefined);
        }
      }

      // ✅ Send email verification if requested.
      // Post-migration: generateEmailVerificationToken returns `{ token? }`
      // directly (no `.success`) and throws NextlyError on real DB faults.
      // Email-send failures are isolated so the user creation still succeeds.
      if (userData.sendWelcomeEmail && this.emailService) {
        try {
          // Generate verification token (without sending a separate email)
          const services = new ServiceContainer(this.adapter);
          const tokenResult =
            await services.auth.generateEmailVerificationToken(user.email, {
              disableEmail: true,
            });

          if (tokenResult.token) {
            await this.emailService.sendEmailVerificationEmail(
              user.email,
              { name: user.name ?? null, email: user.email },
              tokenResult.token
            );
          }
        } catch (err) {
          console.error(
            "[UserMutationService] Failed to send verification email:",
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        roles: userData.roles ?? null,
        isActive: user.isActive ?? undefined,
        createdAt: user.createdAt ?? undefined,
        updatedAt: user.updatedAt ?? undefined,
        // Merge custom field values as top-level properties
        ...(hasExt && !this.userExtDisabled ? customFieldValues : {}),
      };
    } catch (err) {
      // Re-throw NextlyError unchanged (validation, duplicate, internal, ...).
      // Pattern B: classify DB unique-violations as DUPLICATE so the public
      // message stays generic; everything else routes through fromDatabaseError.
      if (NextlyError.is(err)) throw err;
      if (isDbError(err) && err.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { entity: "user", email: userData.email },
        });
      }
      throw NextlyError.fromDatabaseError(err);
    }
  }

  /**
   * Update an existing user's data.
   *
   * @throws NextlyError(VALIDATION_ERROR) on schema-validation failure or
   *   when no actionable changes are provided.
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError(DUPLICATE) on email conflicts.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async updateUser(
    userId: number | string,
    changes: UpdateUserData
  ): Promise<UserMutationResponse> {
    try {
      // Validate input (merged schema includes custom field validators when configured)
      const validation = this.getUpdateSchema().safeParse(changes);
      if (!validation.success) {
        throw NextlyError.validation({
          errors: validation.error.issues.map(i => ({
            path: i.path.join(".") || "input",
            code: i.code.toUpperCase(),
            message: i.message,
          })),
          logContext: { entity: "user", userId },
        });
      }

      const { users } = this.tables;

      // 1) Load current user. §13.8 + spec note: user existence is sensitive
      // (account enumeration); the public message stays generic.
      const currentUser = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          id: true,
          email: true,
          name: true,
          image: true,
          emailVerified: true,
          isActive: true as unknown as boolean,
        },
      });

      if (!currentUser) {
        throw NextlyError.notFound({
          logContext: { entity: "user", id: userId },
        });
      }

      // 2) Build updateData (only include fields that actually change)
      const updateData: UserUpdateData = {};

      // EMAIL
      if (typeof changes.email !== "undefined") {
        const normalizedNewEmail = (changes.email ?? "").trim().toLowerCase();
        const currentEmailNormalized = (currentUser.email ?? "").toLowerCase();

        if (
          normalizedNewEmail &&
          normalizedNewEmail !== currentEmailNormalized
        ) {
          const existing = await this.db.query.users.findFirst({
            where: eq(users.email, normalizedNewEmail),
            columns: { id: true, email: true },
          });

          if (existing && existing.id !== currentUser.id) {
            // §13.8 + account-enumeration: generic public message; the
            // conflict reason + the user/target ids go to logContext.
            throw NextlyError.duplicate({
              logContext: {
                entity: "user",
                reason: "email-conflict",
                userId: currentUser.id,
              },
            });
          }
        }

        if (normalizedNewEmail !== "") updateData.email = normalizedNewEmail;
      }

      if (
        typeof changes.name !== "undefined" &&
        changes.name !== currentUser.name
      ) {
        updateData.name = changes.name;
      }

      // PASSWORD: hash plain-text password before storing
      if (Object.prototype.hasOwnProperty.call(changes, "password")) {
        const rawPassword =
          typeof changes.password === "string" ? changes.password.trim() : "";
        if (rawPassword.length > 0) {
          updateData.passwordHash = await hashPassword(rawPassword);
        }
      }

      // IMAGE: only update if provided in body
      if (Object.prototype.hasOwnProperty.call(changes, "image")) {
        const nextImage = changes.image;
        if (nextImage !== currentUser.image) {
          updateData.image = nextImage;
        }
      }
      if (Object.prototype.hasOwnProperty.call(changes, "emailVerified"))
        if (changes.emailVerified !== currentUser.emailVerified) {
          updateData.emailVerified = changes.emailVerified;
        }

      // ✅ Handle isActive
      if (Object.prototype.hasOwnProperty.call(changes, "isActive")) {
        if (changes.isActive !== currentUser.isActive) {
          updateData.isActive = changes.isActive;
        }
      }

      const hasFieldUpdates = Object.keys(updateData).length > 0;

      // 2b) Extract custom field values from changes (only fields present in payload)
      const hasExt = this.hasCustomFields();
      const customFieldUpdates: Record<string, unknown> = {};
      let hasCustomFieldChanges = false;

      if (hasExt) {
        const fieldNames = this.getCustomFieldNames();
        for (const fieldName of fieldNames) {
          if (fieldName in changes) {
            customFieldUpdates[fieldName] =
              (changes as Record<string, unknown>)[fieldName] ?? null;
            hasCustomFieldChanges = true;
          }
        }
      }

      if (hasFieldUpdates) {
        updateData.updatedAt = new Date();
        await this.db
          .update(users)
          .set(updateData)
          .where(eq(users.id, currentUser.id));
      }

      // 2c) Upsert custom fields in user_ext
      if (hasCustomFieldChanges) {
        const userExtTable = this.getUserExtTable();
        if (userExtTable) {
          try {
            const now = new Date();
            // Required by Drizzle ORM — runtime-generated tables need untyped db access
            const db = this.db as unknown as DrizzleChain;
            // Check if user_ext row exists. DrizzleChain await resolves
            // to Record<string, unknown>[] already.
            const existingExt = await db
              .select({ id: userExtTable.id })
              .from(userExtTable)
              .where(eq(userExtTable.user_id as Column, currentUser.id))
              .limit(1);

            if (existingExt.length > 0) {
              // UPDATE existing row with changed fields only
              await db
                .update(userExtTable)
                .set({ ...customFieldUpdates, updated_at: now })
                .where(eq(userExtTable.user_id as Column, currentUser.id));
            } else {
              // INSERT new row (upsert: row was somehow missing)
              await db.insert(userExtTable).values({
                id: randomUUID(),
                user_id: currentUser.id,
                ...customFieldUpdates,
                created_at: now,
                updated_at: now,
              });
            }
          } catch (err) {
            // user_ext table may not exist on this dialect — disable and skip
            const cause = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `user_ext upsert skipped during updateUser: ${cause}`
            );
            this.userExtDisabled = true;
            hasCustomFieldChanges = false;
          }
        }
      }

      // 3) Handle role updates
      let hasRoleUpdates = !!(changes.roles && changes.roles.length > 0);
      if (hasRoleUpdates) {
        const services = new ServiceContainer(this.adapter);
        // Compare with current roles to avoid no-op updates
        let currentRoleIds: string[] = [];
        try {
          currentRoleIds = await services.userRoles.listUserRoles(
            String(currentUser.id)
          );
        } catch {
          currentRoleIds = [];
        }
        const requestedRoleIds = Array.from(new Set(changes.roles ?? []));
        const currentSet = new Set(currentRoleIds);
        const requestedSet = new Set(requestedRoleIds);
        const setsEqual =
          currentSet.size === requestedSet.size &&
          [...currentSet].every(id => requestedSet.has(id));
        if (setsEqual) {
          hasRoleUpdates = false;
        }

        if (hasRoleUpdates) {
          await this.db
            .delete(this.tables.userRoles)
            .where(eq(this.tables.userRoles.userId, String(currentUser.id)));

          for (const rid of requestedRoleIds) {
            await services.userRoles
              .assignRoleToUser(String(currentUser.id), rid)
              .catch(() => undefined);
          }
        }
      }

      // If no valid changes provided, throw a validation error so callers
      // can surface a 400. §13.8: per-error message names the (synthetic)
      // field but never the value.
      if (
        !hasFieldUpdates &&
        !hasRoleUpdates &&
        !hasCustomFieldChanges &&
        !changes.sendWelcomeEmail
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "input",
              code: "NO_CHANGES",
              message: "At least one updatable field must be provided.",
            },
          ],
          logContext: { entity: "user", userId: currentUser.id },
        });
      }

      // Fetch updated user
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, currentUser.id),
        columns: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          isActive: true as unknown as boolean,
        },
      });

      // Fetch custom fields for response
      const responseCustomFields: Record<string, unknown> = {};
      if (hasExt) {
        const userExtTable = this.getUserExtTable();
        if (userExtTable) {
          try {
            // Required by Drizzle ORM — runtime-generated tables need
            // untyped db access. DrizzleChain await resolves to row list.
            const extDb = this.db as unknown as DrizzleChain;
            const extRows = await extDb
              .select()
              .from(userExtTable)
              .where(eq(userExtTable.user_id as Column, currentUser.id))
              .limit(1);

            if (extRows.length > 0) {
              const fieldNames = this.getCustomFieldNames();
              for (const fieldName of fieldNames) {
                if (fieldName in extRows[0]) {
                  responseCustomFields[fieldName] = extRows[0][fieldName];
                }
              }
            }
          } catch {
            // user_ext table may not exist — skip
            this.userExtDisabled = true;
          }
        }
      }

      // ✅ Send welcome email if requested and service is available
      if (changes.sendWelcomeEmail && this.emailService) {
        await this.emailService
          .sendWelcomeEmail(user!.email, {
            name: user!.name ?? null,
            email: user!.email,
          })
          .catch(() => undefined);
      }

      return {
        id: user!.id,
        email: user!.email,
        emailVerified: user!.emailVerified ?? null,
        name: user!.name ?? null,
        image: user!.image ?? null,
        roles: changes.roles ?? null,
        isActive: user!.isActive ?? undefined,
        // Merge custom field values as top-level properties
        ...(hasExt ? responseCustomFields : {}),
      };
    } catch (err) {
      // Re-throw NextlyError (validation, not-found, duplicate) unchanged.
      // Pattern B: classify DB unique-violations as DUPLICATE so the public
      // message stays generic; everything else routes through fromDatabaseError.
      if (NextlyError.is(err)) throw err;
      if (isDbError(err) && err.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { entity: "user", reason: "email-conflict", userId },
        });
      }
      throw NextlyError.fromDatabaseError(err);
    }
  }

  /**
   * Delete a user and all related data (roles, accounts).
   *
   * §13.8 + spec note: user existence is sensitive (account enumeration);
   * the public message stays generic. The id flows only through logContext.
   *
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async deleteUser(userId: number | string): Promise<void> {
    const { users, accounts, userRoles } = this.tables;

    // Check if user exists
    let user;
    try {
      user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { id: true },
      });
    } catch (err) {
      throw NextlyError.fromDatabaseError(err);
    }

    if (!user) {
      throw NextlyError.notFound({
        logContext: { entity: "user", id: userId },
      });
    }

    // Delete user and related data in a single Drizzle transaction so that
    // partial deletes can't leave orphaned rows. The tx alias is `any` because
    // BaseService.withTransaction yields `unknown` (it can't reference the
    // dialect-specific Drizzle transaction type without binding to all three
    // driver packages); the fluent query API is identical across dialects.
    try {
      await this.withTransaction(async tx => {
        const txDb = tx as DrizzleTransactionLike;
        // Delete user_ext row if custom fields are configured
        if (this.hasCustomFields()) {
          const userExtTable = this.getUserExtTable();
          if (userExtTable) {
            try {
              await txDb
                .delete(userExtTable)
                .where(eq(userExtTable.user_id as Column, userId));
            } catch (err) {
              // user_ext table may not exist on this dialect — skip and disable
              // ext for the rest of this process so subsequent calls don't retry.
              const cause = err instanceof Error ? err.message : String(err);
              this.logger.warn(
                `user_ext delete skipped during deleteUser: ${cause}`
              );
              this.userExtDisabled = true;
            }
          }
        }

        // Delete user roles
        await txDb.delete(userRoles).where(eq(userRoles.userId, userId));

        // Delete user accounts
        await txDb.delete(accounts).where(eq(accounts.userId, userId));

        // Delete user
        await txDb.delete(users).where(eq(users.id, userId));
      });
    } catch (err) {
      if (NextlyError.is(err)) throw err;
      throw NextlyError.fromDatabaseError(err);
    }
  }
}
