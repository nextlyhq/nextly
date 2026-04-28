/**
 * UserAccountService - Profile, Account, and Password operations
 *
 * Handles current user profile updates, OAuth account management,
 * and password-related operations.
 *
 * @example
 * ```typescript
 * const accountService = new UserAccountService(adapter, logger);
 *
 * const profile = await accountService.getCurrentUser(userId);
 * await accountService.updateCurrentUser(userId, { name: 'New Name' });
 * const accounts = await accountService.getAccounts(userId);
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import type { MinimalUser, UserAccount } from "@nextly/types/auth";
import type {
  AccountSelectResult,
  AccountCountResult,
  DatabaseInstance,
} from "@nextly/types/database-operations";

// PR 4 of unified-error-system migration: ServiceError result-shapes →
// NextlyError throws. Methods now return data directly or throw.
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import { UserQueryService } from "./user-query-service";

/**
 * Response type for single user operations.
 * Post-migration: data is returned directly (callers no longer destructure
 * `.success`/`.data`); failures throw NextlyError.
 */
export type GetUserResponse = MinimalUser;

/**
 * Response type for account list operations.
 * Post-migration: an empty array is returned when no accounts are linked,
 * and DB failures throw NextlyError. The 404-when-empty behavior was an
 * envelope quirk and not a real precondition violation.
 */
export type GetAccountsResponse = UserAccount[];

/**
 * Response type for unlink account operation
 */
export type UnlinkAccountResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export class UserAccountService extends BaseService {
  private queryService: UserQueryService;

  /**
   * Creates a new UserAccountService instance.
   *
   * @param adapter - Database adapter for multi-database support
   * @param logger - Logger instance
   */
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    this.queryService = new UserQueryService(adapter, logger);
  }

  // ========================================
  // Profile Operations
  // ========================================

  /**
   * Get the current user's profile (delegates to getUserById).
   *
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   */
  async getCurrentUser(userId: number | string): Promise<GetUserResponse> {
    return this.queryService.getUserById(userId);
  }

  /**
   * Update the current user's profile (name and image only).
   *
   * @throws NextlyError(NOT_FOUND) when the user does not exist
   *   (propagated from queryService.getUserById).
   * @throws NextlyError(DUPLICATE) on unique-violation collisions (e.g.
   *   email already belongs to another user).
   * @throws NextlyError on other DB errors via fromDatabaseError.
   */
  async updateCurrentUser(
    userId: number | string,
    changes: {
      name?: string;
      image?: string;
    }
  ): Promise<GetUserResponse> {
    // Validate that user exists first. getUserById throws NOT_FOUND when
    // missing; we let that propagate unchanged.
    await this.queryService.getUserById(userId);

    const { users } = this.tables;

    // Only allow updating name and image for current user
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (changes.name !== undefined) {
      updateData.name = changes.name;
    }

    if (changes.image !== undefined) {
      updateData.image = changes.image;
    }

    try {
      await this.db.update(users).set(updateData).where(eq(users.id, userId));
    } catch (error) {
      // Pattern B: unique-violation on (email) → DUPLICATE; everything else
      // routes through fromDatabaseError. §13.8: no identifiers in the
      // public message; the user id + a routing reason go to logContext.
      // Normalise raw driver errors to DbError so the unique-violation
      // branch and fromDatabaseError both see the right kind. Without this
      // a real PG 23505 collapses to INTERNAL_ERROR.
      const dbErr = toDbError(this.dialect, error);
      if (dbErr.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { reason: "email-conflict", userId },
        });
      }
      throw NextlyError.fromDatabaseError(dbErr);
    }

    // Fetch and return updated user
    return this.queryService.getUserById(userId);
  }

  // ========================================
  // Password Operations
  // ========================================

  /**
   * Update a user's password hash.
   *
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async updatePasswordHash(
    userId: number | string,
    passwordHash: string
  ): Promise<void> {
    const { users } = this.tables;

    // Check if user exists. §13.8 + spec note: user existence is sensitive,
    // so the public message stays generic; the id flows through logContext.
    let user;
    try {
      user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { id: true },
      });
    } catch (err) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }

    if (!user) {
      throw NextlyError.notFound({
        logContext: { entity: "user", id: userId },
      });
    }

    try {
      // Update password
      await (this.db as DatabaseInstance)
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, userId));
    } catch (err) {
      // Normalise raw driver errors so the kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /**
   * Check if a user has a password set
   */
  async hasPassword(userId: number | string): Promise<boolean> {
    const { users } = this.tables;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        passwordHash: true,
      },
    });
    const hash = user?.passwordHash;
    return !!(hash && String(hash).length > 0);
  }

  /**
   * Get a user's password hash by ID
   */
  async getUserPasswordHashById(
    userId: number | string
  ): Promise<string | null> {
    const { users } = this.tables;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        passwordHash: true,
      },
    });
    return user?.passwordHash ?? null;
  }

  // ========================================
  // OAuth Account Operations
  // ========================================

  /**
   * Get all OAuth accounts linked to a user.
   *
   * Returns an empty array when no accounts are linked. The pre-migration
   * "404 No accounts linked to this user" was an envelope quirk — having
   * zero linked accounts is a normal state for password-only users, not an
   * error condition. Callers that need the count should check `.length`.
   *
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async getAccounts(userId: number | string): Promise<GetAccountsResponse> {
    const { accounts } = this.tables;

    let results;
    try {
      results = await this.db.query.accounts.findMany({
        where: eq(accounts.userId, userId),
        columns: {
          id: true,
          userId: true,
          provider: true,
          providerAccountId: true,
          type: true,
        },
      });
    } catch (err) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }

    return (results ?? []).map((r: AccountSelectResult) => ({
      id: r.id,
      userId: r.userId,
      provider: String(r.provider),
      providerAccountId: String(r.providerAccountId),
      type: String(r.type),
    }));
  }

  /**
   * Delete a specific OAuth account for a user
   */
  async deleteUserAccount(
    userId: number | string,
    provider: string,
    providerAccountId: string
  ): Promise<number> {
    const { accounts } = this.tables;
    // Count before
    const beforeRows = (await (this.db as DatabaseInstance)
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.provider, provider),
          eq(accounts.providerAccountId, providerAccountId)
        )
      )) as AccountCountResult[];

    await (this.db as DatabaseInstance)
      .delete(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.provider, provider),
          eq(accounts.providerAccountId, providerAccountId)
        )
      );

    const afterRows = (await (this.db as DatabaseInstance)
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.provider, provider),
          eq(accounts.providerAccountId, providerAccountId)
        )
      )) as AccountCountResult[];

    const deleted = Math.max(
      (beforeRows?.length ?? 0) - (afterRows?.length ?? 0),
      0
    );
    return deleted;
  }

  /**
   * Unlink an OAuth account from a user (with safety check for last auth method).
   *
   * Returns an `UnlinkAccountResult` discriminated union rather than throwing
   * for the safety-check failure / not-found cases. These are caller-facing
   * decisions (e.g. show a confirmation prompt, render a 400 response) where
   * a thrown error would force the caller to write try/catch around a
   * predictable control-flow branch. Real DB faults still throw NextlyError.
   */
  async unlinkAccountForUser(
    userId: number | string,
    provider: string,
    providerAccountId: string
  ): Promise<UnlinkAccountResult> {
    // getAccounts now returns the array directly (post-migration).
    const accounts = await this.getAccounts(userId);
    const numAccounts = accounts.length;
    const hasPwd = await this.hasPassword(userId);
    if (!hasPwd && numAccounts <= 1) {
      return {
        ok: false,
        status: 400,
        error:
          "Cannot unlink the last authentication method without a password set.",
      };
    }
    const deleted = await this.deleteUserAccount(
      userId,
      provider,
      providerAccountId
    );
    if (deleted === 0) return { ok: false, status: 404, error: "Not found" };
    return { ok: true };
  }
}
