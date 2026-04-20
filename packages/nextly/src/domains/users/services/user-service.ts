/**
 * UserService - Unified service for user operations
 *
 * This service provides a clean API for user management operations following
 * the new service layer architecture with:
 *
 * - Exception-based error handling using ServiceError
 * - RequestContext for user/locale context
 * - PaginatedResult for list operations
 *
 * Internally delegates to UserQueryService, UserMutationService, and
 * UserAccountService for the actual implementation.
 *
 * @example
 * ```typescript
 * import { UserService, ServiceError, isServiceError } from '@revnixhq/nextly';
 *
 * const service = new UserService(queryService, mutationService, accountService);
 *
 * // Create a user
 * const user = await service.create({
 *   email: 'user@example.com',
 *   name: 'John Doe',
 *   password: 'securePassword123',
 * }, context);
 *
 * // Authenticate
 * const authenticatedUser = await service.authenticate('user@example.com', 'password');
 *
 * // Error handling
 * try {
 *   const user = await service.findById('nonexistent', context);
 * } catch (error) {
 *   if (isServiceError(error)) {
 *     console.log(error.code); // 'NOT_FOUND'
 *     console.log(error.httpStatus); // 404
 *   }
 * }
 * ```
 */

import { ServiceError, ServiceErrorCode } from "../../../errors";
import type {
  RequestContext,
  PaginatedResult,
  Logger,
} from "../../../services/shared";
import { consoleLogger } from "../../../services/shared";

import type { UserAccountService } from "./user-account-service";
import type { UserMutationService } from "./user-mutation-service";
import type { UserQueryService, ListUsersOptions } from "./user-query-service";

// ============================================================
// Types
// ============================================================

/**
 * User returned from operations (password hash never included)
 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  image?: string | null;
  emailVerified: Date | null;
  isActive?: boolean;
  roles?: string[] | null;
  createdAt?: Date;
  updatedAt?: Date;
  /** Custom fields from user_ext table — present when user extension fields are configured */
  [key: string]: unknown;
}

/**
 * Input for creating a user
 */
export interface CreateUserInput {
  email: string;
  name: string;
  password?: string;
  image?: string | null;
  roles?: string[];
  isActive?: boolean;
  /** Custom field values from user_ext */
  [key: string]: unknown;
}

/**
 * Input for updating a user
 */
export interface UpdateUserInput {
  email?: string;
  name?: string;
  image?: string;
  emailVerified?: Date | null;
  isActive?: boolean;
  /** Custom field values from user_ext */
  [key: string]: unknown;
}

/**
 * Options for listing users
 */
export interface ListUsersQueryOptions {
  pagination?: {
    limit?: number;
    offset?: number;
    page?: number;
  };
  search?: string;
  emailVerified?: boolean;
  hasPassword?: boolean;
  sortBy?: "createdAt" | "name" | "email";
  sortOrder?: "asc" | "desc";
}

/**
 * Password hasher interface for authentication
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

// ============================================================
// UserService
// ============================================================

/**
 * UserService - Unified service for user management
 *
 * Provides user CRUD operations, authentication, and password management with:
 *
 * - Exception-based error handling (throws ServiceError)
 * - Type-safe RequestContext
 * - PaginatedResult for list operations
 * - Logging support
 */
export class UserService {
  constructor(
    private readonly queryService: UserQueryService,
    private readonly mutationService: UserMutationService,
    private readonly accountService: UserAccountService,
    private readonly passwordHasher?: PasswordHasher,
    private readonly logger: Logger = consoleLogger
  ) {}

  // ============================================================
  // User CRUD Operations
  // ============================================================

  /**
   * Create a new user
   *
   * @param input - User creation data
   * @param context - Request context with user info
   * @returns Created user (without password hash)
   * @throws ServiceError if creation fails (e.g., duplicate email)
   *
   * @example
   * ```typescript
   * const user = await service.create({
   *   email: 'user@example.com',
   *   name: 'John Doe',
   *   password: 'securePassword123',
   * }, context);
   * ```
   */
  async create(input: CreateUserInput, context: RequestContext): Promise<User> {
    this.logger.debug("Creating user", {
      email: input.email,
      userId: context.user?.id,
    });

    // Extract known fields, pass rest as custom field values
    const { email, name, password, image, roles, isActive, ...customFields } =
      input;
    const result = await this.mutationService.createLocalUser({
      email,
      name,
      password: password ?? null,
      image,
      roles,
      isActive,
      ...customFields,
    });

    if (!result.success) {
      this.logger.warn("User creation failed", {
        email: input.email,
        message: result.message,
        statusCode: result.statusCode,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("User created", {
      email: input.email,
      userId: result.data?.id,
    });

    return this.mapToUser(result.data!);
  }

  /**
   * Find a user by ID
   *
   * @param userId - User ID
   * @param context - Request context
   * @returns User data
   * @throws ServiceError with NOT_FOUND if user doesn't exist
   */
  async findById(userId: string, _context: RequestContext): Promise<User> {
    this.logger.debug("Finding user by ID", { userId });

    const result = await this.queryService.getUserById(userId);

    if (!result.success || !result.data) {
      throw ServiceError.notFound(`User not found: ${userId}`, {
        entity: "user",
        userId,
      });
    }

    return this.mapToUser(result.data);
  }

  /**
   * Find a user by email address
   *
   * @param email - Email address
   * @param context - Request context
   * @returns User data or null if not found
   */
  async findByEmail(
    email: string,
    _context: RequestContext
  ): Promise<User | null> {
    this.logger.debug("Finding user by email", { email });

    const user = await this.queryService.findByEmail(email);

    if (!user) {
      return null;
    }

    return this.mapToUser(user);
  }

  /**
   * List users with pagination and filtering
   *
   * @param options - Query options (pagination, search, filters)
   * @param context - Request context
   * @returns Paginated list of users
   */
  async listUsers(
    options: ListUsersQueryOptions = {},
    _context: RequestContext
  ): Promise<PaginatedResult<User>> {
    this.logger.debug("Listing users", { options });

    const pageSize = options.pagination?.limit ?? 10;
    const page = options.pagination?.page ?? 1;

    const legacyOptions: ListUsersOptions = {
      page,
      pageSize,
      search: options.search,
      emailVerified: options.emailVerified,
      hasPassword: options.hasPassword,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
    };

    const result = await this.queryService.listUsers(legacyOptions);

    if (!result.success) {
      throw this.mapLegacyErrorToServiceError(result);
    }

    const users = (result.data ?? []).map(u => this.mapToUser(u));
    const total = result.meta?.total ?? users.length;
    const offset = (page - 1) * pageSize;

    return {
      data: users,
      pagination: {
        total,
        limit: pageSize,
        offset,
        hasMore: offset + users.length < total,
      },
    };
  }

  /**
   * Update a user
   *
   * @param userId - User ID to update
   * @param input - Update data
   * @param context - Request context
   * @returns Updated user
   * @throws ServiceError if update fails
   */
  async update(
    userId: string,
    input: UpdateUserInput,
    _context: RequestContext
  ): Promise<User> {
    this.logger.debug("Updating user", { userId, input });

    // Extract known fields, pass rest as custom field values
    const { email, name, image, emailVerified, isActive, ...customFields } =
      input;
    const result = await this.mutationService.updateUser(userId, {
      email,
      name,
      image,
      emailVerified,
      isActive,
      ...customFields,
    });

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`User not found: ${userId}`, {
          entity: "user",
          userId,
        });
      }
      this.logger.warn("User update failed", {
        userId,
        message: result.message,
        statusCode: result.statusCode,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("User updated", { userId });

    return this.mapToUser(result.data!);
  }

  /**
   * Delete a user
   *
   * @param userId - User ID to delete
   * @param context - Request context
   * @throws ServiceError if deletion fails
   */
  async delete(userId: string, _context: RequestContext): Promise<void> {
    this.logger.debug("Deleting user", { userId });

    const result = await this.mutationService.deleteUser(userId);

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`User not found: ${userId}`, {
          entity: "user",
          userId,
        });
      }
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("User deleted", { userId });
  }

  // ============================================================
  // Authentication Operations
  // ============================================================

  /**
   * Authenticate a user with email and password
   *
   * Verifies credentials only - does NOT create a session.
   * Use the returned user to create a session via your auth system.
   *
   * @param email - User email
   * @param password - User password
   * @returns Authenticated user (without password hash)
   * @throws ServiceError with INVALID_CREDENTIALS if authentication fails
   *
   * @example
   * ```typescript
   * try {
   *   const user = await service.authenticate('user@example.com', 'password');
   *   // Create session with your auth system
   *   await createSession(user.id);
   * } catch (error) {
   *   if (isServiceError(error) && error.code === ServiceErrorCode.INVALID_CREDENTIALS) {
   *     return { error: 'Invalid email or password' };
   *   }
   * }
   * ```
   */
  async authenticate(email: string, password: string): Promise<User> {
    this.logger.debug("Authenticating user", { email });

    // Get user with password hash via account service
    const passwordHash = await this.getPasswordHashByEmail(email);

    if (!passwordHash) {
      this.logger.warn(
        "Authentication failed - user not found or no password",
        {
          email,
        }
      );
      throw new ServiceError(
        ServiceErrorCode.INVALID_CREDENTIALS,
        "Invalid email or password"
      );
    }

    // Verify password
    if (!this.passwordHasher) {
      throw ServiceError.internal(
        "Password hasher not configured for UserService"
      );
    }

    const isValid = await this.passwordHasher.verify(password, passwordHash);

    if (!isValid) {
      this.logger.warn("Authentication failed - invalid password", { email });
      throw new ServiceError(
        ServiceErrorCode.INVALID_CREDENTIALS,
        "Invalid email or password"
      );
    }

    // Get full user data
    const user = await this.queryService.findByEmail(email);

    if (!user) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_CREDENTIALS,
        "Invalid email or password"
      );
    }

    this.logger.info("User authenticated", { userId: user.id, email });

    return this.mapToUser(user);
  }

  // ============================================================
  // Password Operations
  // ============================================================

  /**
   * Change a user's password
   *
   * @param userId - User ID
   * @param currentPassword - Current password for verification
   * @param newPassword - New password to set
   * @throws ServiceError if password change fails
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    this.logger.debug("Changing password", { userId });

    // Verify current password
    const currentHash =
      await this.accountService.getUserPasswordHashById(userId);

    if (!currentHash) {
      throw ServiceError.notFound("User not found or no password set", {
        userId,
      });
    }

    if (!this.passwordHasher) {
      throw ServiceError.internal(
        "Password hasher not configured for UserService"
      );
    }

    const isValid = await this.passwordHasher.verify(
      currentPassword,
      currentHash
    );

    if (!isValid) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_CREDENTIALS,
        "Current password is incorrect"
      );
    }

    // Hash and update new password
    const newHash = await this.passwordHasher.hash(newPassword);
    const result = await this.accountService.updatePasswordHash(
      userId,
      newHash
    );

    if (!result.success) {
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Password changed", { userId });
  }

  /**
   * Check if a user has a password set
   *
   * @param userId - User ID
   * @returns True if user has a password
   */
  async hasPassword(userId: string): Promise<boolean> {
    return this.accountService.hasPassword(userId);
  }

  // ============================================================
  // Profile Operations
  // ============================================================

  /**
   * Update the current user's profile (name and image only)
   *
   * Use this for self-service profile updates where users can only
   * change their own name and image.
   *
   * @param userId - User ID
   * @param changes - Profile changes (name, image)
   * @param context - Request context
   * @returns Updated user
   */
  async updateProfile(
    userId: string,
    changes: { name?: string; image?: string },
    _context: RequestContext
  ): Promise<User> {
    this.logger.debug("Updating user profile", { userId, changes });

    const result = await this.accountService.updateCurrentUser(userId, changes);

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`User not found: ${userId}`, {
          entity: "user",
          userId,
        });
      }
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("User profile updated", { userId });

    return this.mapToUser(result.data!);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Get password hash by email (for authentication)
   */
  private async getPasswordHashByEmail(email: string): Promise<string | null> {
    // Find user first to get ID
    const user = await this.queryService.findByEmail(email);
    if (!user) {
      return null;
    }

    return this.accountService.getUserPasswordHashById(user.id);
  }

  /**
   * Map legacy user data to User type
   * Converts id to string since legacy services may return number | string
   */
  private mapToUser(data: {
    id: string | number;
    email: string;
    name?: string | null;
    image?: string | null;
    emailVerified?: Date | string | null;
    isActive?: boolean | null;
    roles?: string[] | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
    [key: string]: unknown;
  }): User {
    // Extract known fields explicitly, then spread the rest as custom fields
    const {
      id,
      email,
      name,
      image,
      emailVerified,
      isActive,
      roles,
      createdAt,
      updatedAt,
      passwordHash: _passwordHash, // always strip — never expose hashes
      ...customFields
    } = data;

    return {
      ...customFields,
      id: String(id),
      email,
      name: name ?? null,
      image,
      emailVerified: emailVerified
        ? emailVerified instanceof Date
          ? emailVerified
          : new Date(emailVerified)
        : null,
      isActive: isActive ?? undefined,
      roles,
      createdAt: createdAt
        ? createdAt instanceof Date
          ? createdAt
          : new Date(createdAt)
        : undefined,
      updatedAt: updatedAt
        ? updatedAt instanceof Date
          ? updatedAt
          : new Date(updatedAt)
        : undefined,
    };
  }

  /**
   * Convert legacy service result format to ServiceError
   */
  private mapLegacyErrorToServiceError(result: {
    success: boolean;
    statusCode: number;
    message: string;
    data: unknown;
  }): ServiceError {
    const { statusCode, message } = result;

    switch (statusCode) {
      case 400:
        return ServiceError.validation(message);
      case 401:
        return ServiceError.unauthorized(message);
      case 403:
        return ServiceError.forbidden(message);
      case 404:
        return ServiceError.notFound(message);
      case 409:
        return ServiceError.duplicate(message);
      case 422:
        return ServiceError.businessRule(message);
      default:
        return ServiceError.internal(message);
    }
  }
}
