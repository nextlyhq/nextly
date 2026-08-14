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
/**
 * The `FindArgs` options the users namespace actually forwards.
 *
 * Users are a core table with their own query service rather than a dynamic
 * collection, and `users.find()` passes only pagination through to it. Anything
 * else inherited from `FindArgs` was accepted and silently discarded: a `where`
 * clause filtered nothing and returned the first arbitrary user, which reads at
 * the call site as a successful exact lookup.
 *
 * Named as an ALLOW-list rather than as an omission, so the default for anything
 * new is refusal. A deny-list re-opens itself the moment `FindArgs` gains an
 * option — the new one would be inherited, ignored at runtime, and produce a
 * plausible wrong row with no compile error, which is the same failure this
 * type is here to prevent.
 *
 * To support one of the others, forward it in `namespaces/users.ts` and add it
 * here in the same change.
 */
type ForwardedFindOptions = "limit" | "page";

export interface FindUsersArgs
  extends Pick<FindArgs, ForwardedFindOptions>,
    DirectAPIConfig {
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
 *
 * `draft` is omitted from the shared find-by-ID options: the working-draft
 * overlay applies to drafts-enabled content collections, and the users
 * namespace does not forward it, so exposing it here would advertise an option
 * that is silently ignored.
 */
export interface FindUserByIDArgs
  extends Omit<FindByIDArgs, "collection" | "draft"> {
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
