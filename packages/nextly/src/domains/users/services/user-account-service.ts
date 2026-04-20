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

import { BaseService } from "../../../services/base-service";
import { mapDbErrorToServiceError } from "../../../services/lib/db-error";
import type { Logger } from "../../../services/shared";

import { UserQueryService } from "./user-query-service";

/**
 * Response type for single user operations
 */
export interface GetUserResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: MinimalUser | null;
}

/**
 * Response type for account list operations
 */
export interface GetAccountsResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: UserAccount[] | null;
}

/**
 * Response type for password operations
 */
export interface PasswordOperationResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: null;
}

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
   * Get the current user's profile (delegates to getUserById)
   */
  async getCurrentUser(userId: number | string): Promise<GetUserResponse> {
    return this.queryService.getUserById(userId);
  }

  /**
   * Update the current user's profile (name and image only)
   */
  async updateCurrentUser(
    userId: number | string,
    changes: {
      name?: string;
      image?: string;
    }
  ): Promise<GetUserResponse> {
    try {
      const { users } = this.tables;

      // Validate that user exists first
      const existingUser = await this.queryService.getUserById(userId);
      if (!existingUser.success || !existingUser.data) {
        return {
          success: false,
          statusCode: 404,
          message: "User not found",
          data: null,
        };
      }

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

      await this.db.update(users).set(updateData).where(eq(users.id, userId));

      // Fetch and return updated user
      return this.queryService.getUserById(userId);
    } catch (error) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to update user profile",
        "unique-violation": "Another user with this email already exists",
        constraint: "Another user with this email already exists",
      });
    }
  }

  // ========================================
  // Password Operations
  // ========================================

  /**
   * Update a user's password hash
   */
  async updatePasswordHash(
    userId: number | string,
    passwordHash: string
  ): Promise<PasswordOperationResponse> {
    try {
      const { users } = this.tables;

      // Check if user exists
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { id: true },
      });

      if (!user) {
        return {
          success: false,
          statusCode: 404,
          message: "User not found",
          data: null,
        };
      }

      // Update password
      await (this.db as DatabaseInstance)
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, userId));

      return {
        success: true,
        statusCode: 200,
        message: "Password updated successfully",
        data: null,
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to update password",
      });
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
   * Get all OAuth accounts linked to a user
   */
  async getAccounts(userId: number | string): Promise<GetAccountsResponse> {
    try {
      const { accounts } = this.tables;

      const results = await this.db.query.accounts.findMany({
        where: eq(accounts.userId, userId),
        columns: {
          id: true,
          userId: true,
          provider: true,
          providerAccountId: true,
          type: true,
        },
      });

      if (!results || results.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "No accounts linked to this user",
          data: null,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "Accounts fetched successfully",
        data: results.map((r: AccountSelectResult) => ({
          id: r.id,
          userId: r.userId,
          provider: String(r.provider),
          providerAccountId: String(r.providerAccountId),
          type: String(r.type),
        })),
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to fetch accounts",
      });
    }
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
   * Unlink an OAuth account from a user (with safety check for last auth method)
   */
  async unlinkAccountForUser(
    userId: number | string,
    provider: string,
    providerAccountId: string
  ): Promise<UnlinkAccountResult> {
    const accountsResult = await this.getAccounts(userId);
    const numAccounts = accountsResult.data ? accountsResult.data.length : 0;
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
