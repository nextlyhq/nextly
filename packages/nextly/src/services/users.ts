/**
 * UsersService - Facade for user operations
 *
 * This service acts as a facade, delegating to specialized services:
 * - UserQueryService: List, get, find operations
 * - UserMutationService: Create, update, delete operations
 * - UserAccountService: Profile, password, OAuth account operations
 *
 * For new code, consider using the specialized services directly for better
 * separation of concerns.
 *
 * PR 4 (unified-error-system): facade methods now mirror the underlying
 * services — they return the value directly and throw NextlyError on
 * failure rather than returning `{ success, statusCode, message, data }`
 * envelopes. Callers should use try/catch with NextlyError.is*() guards.
 *
 * @example
 * ```typescript
 * const usersService = new UsersService(adapter, logger);
 * const users = await usersService.listUsers();
 *
 * // Using specialized services directly (recommended for new code)
 * import { UserQueryService, UserMutationService } from './users/index';
 * const queryService = new UserQueryService(adapter, logger);
 * const users = await queryService.listUsers();
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { MinimalUser } from "../types/auth";
import type { UserConfig } from "../users/config/types";

import { BaseService } from "./base-service";
import type { EmailService } from "./email/email-service";
import type { Logger } from "./shared";
import {
  UserAccountService,
  type GetAccountsResponse,
  type UnlinkAccountResult,
} from "./users/user-account-service";
import type { UserExtSchemaService } from "./users/user-ext-schema-service";
import {
  UserMutationService,
  type UserMutationResponse,
} from "./users/user-mutation-service";
import {
  UserQueryService,
  type GetUserResponse,
  type ListUsersResponse,
} from "./users/user-query-service";

export class UsersService extends BaseService {
  private queryService: UserQueryService;
  private mutationService: UserMutationService;
  private accountService: UserAccountService;

  /**
   * Creates a new UsersService instance.
   *
   * @param adapter - Database adapter for multi-database support
   * @param logger - Logger instance
   * @param userConfig - Optional user extension configuration (custom fields)
   * @param userExtSchemaService - Optional schema service for runtime user_ext table
   * @param emailService - Optional email service for welcome emails
   */
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    userConfig?: UserConfig,
    userExtSchemaService?: UserExtSchemaService,
    emailService?: EmailService
  ) {
    super(adapter, logger);

    // Initialize sub-services, forwarding adapter/logger and optional config
    this.queryService = new UserQueryService(
      adapter,
      logger,
      userConfig,
      userExtSchemaService
    );
    this.mutationService = new UserMutationService(
      adapter,
      logger,
      userConfig,
      userExtSchemaService,
      emailService
    );
    this.accountService = new UserAccountService(adapter, logger);
  }

  // ========================================
  // Query Operations (delegated to UserQueryService)
  // ========================================

  /**
   * List users with pagination, filtering, and sorting.
   *
   * PR 4: returns the data envelope directly (no `success` wrapper).
   * Throws NextlyError on failure.
   */
  async listUsers(options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    emailVerified?: boolean;
    hasPassword?: boolean;
    createdAtFrom?: Date;
    createdAtTo?: Date;
    sortBy?: "createdAt" | "name" | "email" | (string & {});
    sortOrder?: "asc" | "desc";
  }): Promise<ListUsersResponse> {
    return this.queryService.listUsers(options);
  }

  /**
   * Get a user by ID.
   *
   * PR 4: returns the user directly. Throws NextlyError(NOT_FOUND) if missing.
   */
  async getUserById(userId: number | string): Promise<GetUserResponse> {
    return this.queryService.getUserById(userId);
  }

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<MinimalUser | null> {
    return this.queryService.findByEmail(email);
  }

  // ========================================
  // Mutation Operations (delegated to UserMutationService)
  // ========================================

  /**
   * Create a new local user.
   *
   * PR 4: returns the created user directly. Throws NextlyError on failure
   * (e.g. DUPLICATE on email collision).
   */
  async createLocalUser(userData: {
    email: string;
    name: string;
    image?: string | null;
    password?: string | null;
    roles?: string[];
    isActive?: boolean;
    sendWelcomeEmail?: boolean;
    [key: string]: unknown;
  }): Promise<UserMutationResponse> {
    return this.mutationService.createLocalUser(userData);
  }

  /**
   * Update an existing user.
   *
   * PR 4: returns the updated user directly. Throws NextlyError(NOT_FOUND)
   * or NextlyError(DUPLICATE) on failure.
   */
  async updateUser(
    userId: number | string,
    changes: {
      email?: string;
      name?: string;
      password?: string | null;
      image?: string;
      emailVerified?: Date | null;
      roles?: string[];
      isActive?: boolean;
      sendWelcomeEmail?: boolean;
      [key: string]: unknown;
    }
  ): Promise<UserMutationResponse> {
    return this.mutationService.updateUser(userId, changes);
  }

  /**
   * Delete a user.
   *
   * PR 4: returns void. Throws NextlyError(NOT_FOUND) when the user does
   * not exist, or NextlyError on DB errors.
   */
  async deleteUser(userId: number | string): Promise<void> {
    return this.mutationService.deleteUser(userId);
  }

  // ========================================
  // Profile Operations (delegated to UserAccountService)
  // ========================================

  /**
   * Get current user profile.
   *
   * PR 4: returns the user directly. Throws NextlyError(NOT_FOUND) if missing.
   */
  async getCurrentUser(userId: number | string): Promise<GetUserResponse> {
    return this.accountService.getCurrentUser(userId);
  }

  /**
   * Update current user profile.
   *
   * PR 4: returns the updated user directly. Throws NextlyError on failure.
   */
  async updateCurrentUser(
    userId: number | string,
    changes: {
      name?: string;
      image?: string;
    }
  ): Promise<GetUserResponse> {
    return this.accountService.updateCurrentUser(userId, changes);
  }

  // ========================================
  // Password Operations (delegated to UserAccountService)
  // ========================================

  /**
   * Update a user's password hash.
   *
   * PR 4: returns void. Throws NextlyError(NOT_FOUND) when the user does
   * not exist, or NextlyError on DB errors.
   */
  async updatePasswordHash(
    userId: number | string,
    passwordHash: string
  ): Promise<void> {
    return this.accountService.updatePasswordHash(userId, passwordHash);
  }

  /**
   * Check if a user has a password set
   */
  async hasPassword(userId: number | string): Promise<boolean> {
    return this.accountService.hasPassword(userId);
  }

  /**
   * Get a user's password hash by ID
   */
  async getUserPasswordHashById(
    userId: number | string
  ): Promise<string | null> {
    return this.accountService.getUserPasswordHashById(userId);
  }

  // ========================================
  // Account Operations (delegated to UserAccountService)
  // ========================================

  /**
   * Get all OAuth accounts linked to a user.
   *
   * PR 4: returns the array directly. Throws NextlyError on failure.
   */
  async getAccounts(userId: number | string): Promise<GetAccountsResponse> {
    return this.accountService.getAccounts(userId);
  }

  /**
   * Delete a specific OAuth account
   */
  async deleteUserAccount(
    userId: number | string,
    provider: string,
    providerAccountId: string
  ): Promise<number> {
    return this.accountService.deleteUserAccount(
      userId,
      provider,
      providerAccountId
    );
  }

  /**
   * Unlink an OAuth account from a user.
   *
   * Note: this method intentionally returns a discriminated union rather
   * than throwing — callers branch on `.ok` (see UserAccountService for
   * rationale). It does NOT follow the throw-based pattern.
   */
  async unlinkAccountForUser(
    userId: number | string,
    provider: string,
    providerAccountId: string
  ): Promise<UnlinkAccountResult> {
    return this.accountService.unlinkAccountForUser(
      userId,
      provider,
      providerAccountId
    );
  }
}
