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

import type { MinimalUser, UserAccount } from "../types/auth";
import type { UserConfig } from "../users/config/types";

import { BaseService } from "./base-service";
import type { EmailService } from "./email/email-service";
import type { Logger } from "./shared";
import { UserAccountService } from "./users/user-account-service";
import type { UserExtSchemaService } from "./users/user-ext-schema-service";
import { UserMutationService } from "./users/user-mutation-service";
import { UserQueryService } from "./users/user-query-service";

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
   * List users with pagination, filtering, and sorting
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
  }): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser[] | null;
    meta?: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    return this.queryService.listUsers(options);
  }

  /**
   * Get a user by ID
   */
  async getUserById(userId: number | string): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser | null;
  }> {
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
   * Create a new local user
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
  }): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser | null;
  }> {
    return this.mutationService.createLocalUser(userData);
  }

  /**
   * Update an existing user
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
  ): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser | null;
  }> {
    return this.mutationService.updateUser(userId, changes);
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: number | string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: null;
  }> {
    return this.mutationService.deleteUser(userId);
  }

  // ========================================
  // Profile Operations (delegated to UserAccountService)
  // ========================================

  /**
   * Get current user profile
   */
  async getCurrentUser(userId: number | string): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser | null;
  }> {
    return this.accountService.getCurrentUser(userId);
  }

  /**
   * Update current user profile
   */
  async updateCurrentUser(
    userId: number | string,
    changes: {
      name?: string;
      image?: string;
    }
  ): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser | null;
  }> {
    return this.accountService.updateCurrentUser(userId, changes);
  }

  // ========================================
  // Password Operations (delegated to UserAccountService)
  // ========================================

  /**
   * Update a user's password hash
   */
  async updatePasswordHash(
    userId: number | string,
    passwordHash: string
  ): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: null;
  }> {
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
   * Get all OAuth accounts linked to a user
   */
  async getAccounts(userId: number | string): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: UserAccount[] | null;
  }> {
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
   * Unlink an OAuth account from a user
   */
  async unlinkAccountForUser(
    userId: number | string,
    provider: string,
    providerAccountId: string
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    return this.accountService.unlinkAccountForUser(
      userId,
      provider,
      providerAccountId
    );
  }
}
