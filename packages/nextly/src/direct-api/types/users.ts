/**
 * Direct API Users Type Definitions
 *
 * Argument types for the `nextly.users.*` namespace.
 *
 * @packageDocumentation
 */

import type {
  CreateArgs,
  DeleteArgs,
  FindArgs,
  FindByIDArgs,
  UpdateArgs,
} from "./collections";
import type { DirectAPIConfig } from "./shared";

/**
 * Arguments for finding users.
 *
 * Extends FindArgs with user-specific filter and sort options.
 *
 * @example
 * ```typescript
 * // List all verified users, newest first
 * const result = await nextly.users.find({
 *   emailVerified: true,
 *   sortBy: 'createdAt',
 *   sortOrder: 'desc',
 *   limit: 20,
 * });
 *
 * // Search by name or email
 * const result = await nextly.users.find({ search: 'john' });
 * ```
 */
export interface FindUsersArgs extends Omit<FindArgs, "collection"> {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** Search query across name, email, and custom text fields */
  search?: string;

  /** Filter by email verification status */
  emailVerified?: boolean;

  /** Filter by whether user has a password set */
  hasPassword?: boolean;

  /** Sort field */
  sortBy?: "createdAt" | "name" | "email";

  /** Sort direction */
  sortOrder?: "asc" | "desc";
}

/**
 * Arguments for finding a single user by criteria.
 *
 * Returns the first user matching the provided filters, or `null` if not found.
 * Consistent with collection `findByID` semantics — use `users.findByID` when
 * you already have the user ID; use `findOne` when querying by other attributes.
 *
 * @example
 * ```typescript
 * // Find by email (exact match via search)
 * const user = await nextly.users.findOne({ search: 'john@example.com' });
 *
 * // Find first unverified user
 * const unverified = await nextly.users.findOne({ emailVerified: false });
 * ```
 */
export interface FindOneUserArgs extends DirectAPIConfig {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** Search query across name, email, and custom text fields */
  search?: string;

  /** Filter by email verification status */
  emailVerified?: boolean;

  /** Filter by whether user has a password set */
  hasPassword?: boolean;
}

/**
 * Arguments for finding a user by ID.
 */
export interface FindUserByIDArgs extends Omit<FindByIDArgs, "collection"> {
  /** User collection slug (defaults to 'users') */
  collection?: string;
}

/**
 * Arguments for creating a user.
 */
export interface CreateUserArgs extends Omit<CreateArgs, "collection"> {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** User email (required) */
  email: string;

  /** User password (required) */
  password: string;
}

/**
 * Arguments for updating a user.
 */
export interface UpdateUserArgs extends Omit<UpdateArgs, "collection"> {
  /** User collection slug (defaults to 'users') */
  collection?: string;
}

/**
 * Arguments for deleting a user.
 */
export interface DeleteUserArgs extends Omit<DeleteArgs, "collection"> {
  /** User collection slug (defaults to 'users') */
  collection?: string;
}
