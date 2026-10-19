/**
 * UserAccountService - Profile, Account, and Password operations
 *
 * Handles current user profile updates and password-related operations.
 * Linked external accounts are not managed here: their listing and
 * unlinking endpoints are retired.
 *
 * @example
 * ```typescript
 * const accountService = new UserAccountService(adapter, logger);
 *
 * const profile = await accountService.getCurrentUser(userId);
 * await accountService.updateCurrentUser(userId, { name: 'New Name' });
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import type { MinimalUser } from "@nextly/types/auth";

// PR 4 of unified-error-system migration: ServiceError result-shapes →
// NextlyError throws. Methods now return data directly or throw.
import { isPasswordHash } from "../../../auth/password/index";
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";
import { requireFilterValue } from "../../../shared/lib/require-filter-value";

import {
  passwordColumns,
  updateUserEndingSessions,
  type PasswordWriteTx,
} from "./password-write";
import { UserQueryService } from "./user-query-service";

/**
 * Response type for single user operations.
 * Post-migration: data is returned directly (callers no longer destructure
 * `.success`/`.data`); failures throw NextlyError.
 */
export type GetUserResponse = MinimalUser;

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
   * Set a user's password hash, as an administrator does, ending every
   * session the account holds.
   *
   * The same write `updateUser` makes when it sets a password, so the
   * raw-hash route cannot set one and leave the old sessions renewing.
   *
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async updatePasswordHash(
    userId: number | string,
    passwordHash: string
  ): Promise<void> {
    // Before any read: the one password write whose hash comes from outside,
    // so it must be one. A raw password sent here was stored as given; it is
    // refused now as invalid input, never echoed or logged, and before the
    // catch around the write could report it as a database failure. A bcrypt
    // hash, what core's sign-in verifies; an app with its own hasher sets
    // passwords through the service, which hashes them with it.
    if (!isPasswordHash(passwordHash)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "passwordHash",
            code: "INVALID",
            message: "Not a password hash.",
          },
        ],
        logContext: { reason: "password-hash-route-not-a-hash", userId },
      });
    }
    const set = passwordColumns(passwordHash);

    // Check if user exists. §13.8 + spec note: user existence is sensitive,
    // so the public message stays generic; the id flows through logContext.
    let user;
    try {
      user = await this.db.query.users.findFirst({
        where: { id: requireFilterValue(userId, "userId") },
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
      await this.withTransaction(async tx => {
        await updateUserEndingSessions(
          tx as PasswordWriteTx,
          this.tables,
          this.dialect,
          { userId, set }
        );
      });
    } catch (err) {
      // Normalise raw driver errors so the kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /**
   * Set the password a user chose for their own account, ending every
   * session it holds.
   *
   * Conditional on the account not being deactivated, in the same statement:
   * an access token still inside its lifetime must not set a password for a
   * later reactivation to switch on.
   *
   * @returns Whether the password was set; `false` when the account is
   *   deactivated or gone.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async changeOwnPasswordHash(
    userId: number | string,
    passwordHash: string
  ): Promise<boolean> {
    const set = passwordColumns(passwordHash);
    let changed = 0;
    try {
      await this.withTransaction(async tx => {
        changed = await updateUserEndingSessions(
          tx as PasswordWriteTx,
          this.tables,
          this.dialect,
          {
            userId,
            set,
            unlessDeactivated: true,
          }
        );
      });
    } catch (err) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
    return changed === 1;
  }

  /**
   * Check if a user has a password set
   */
  async hasPassword(userId: number | string): Promise<boolean> {
    const user = await this.db.query.users.findFirst({
      where: { id: requireFilterValue(userId, "userId") },
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
    const user = await this.db.query.users.findFirst({
      where: { id: requireFilterValue(userId, "userId") },
      columns: {
        passwordHash: true,
      },
    });
    return user?.passwordHash ?? null;
  }

  // ========================================
  // OAuth Account Operations
  // ========================================
}
