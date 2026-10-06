// Database operation types for better type safety

/**
 * How an account's address came to be verified, stored in
 * `users.email_verified_via` beside `email_verified`. Null exactly when
 * `email_verified` is.
 *
 * - `"link"`: the person followed a verification link sent to the address.
 * - `"invite"`: the person accepted an invite link sent to the address.
 * - `"admin"`: the app vouched for it: an administrator creating or updating
 *   the account, the app's own server code through the Direct API, first-run
 *   setup and the seeders.
 * - `"plugin"`: a plugin vouched for it through `ctx.services.users`.
 * - `"external"`: a login provider vouched for it (`createExternalUser`).
 * - `"legacy"`: verified with nothing recording how: before this column
 *   existed, or by a write outside Nextly's own paths. `nextly migrate` sets it
 *   on every verified row it finds without a value.
 */
export type EmailVerifiedVia =
  | "link"
  | "invite"
  | "admin"
  | "plugin"
  | "external"
  | "legacy";

export interface UserInsertData {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerified: Date | null;
  /** How the address was verified; null when it is not. */
  emailVerifiedVia?: EmailVerifiedVia | null;
  image: string | null;
  isActive?: boolean;
  /** True when an admin set the password and the user must replace it on first sign-in. */
  mustChangePassword?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserUpdateData {
  email?: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
  /** How the address was verified; null when it is not. */
  emailVerifiedVia?: EmailVerifiedVia | null;
  passwordHash?: string;
  /** When the password was last set. */
  passwordUpdatedAt?: Date;
  isActive?: boolean;
  /** When an administrator deactivated the account; null once reactivated. */
  deactivatedAt?: Date | null;
  /** Cleared to false once the user replaces an admin-set password. */
  mustChangePassword?: boolean;
  updatedAt?: Date;
}

export interface UserSelectResult {
  id: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  passwordHash?: string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserListSelectResult {
  id: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  passwordHash: string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  roles?: Array<{ id: string; name: string }>;
}

export interface AccountSelectResult {
  id: number;
  userId: string;
  provider: string;
  providerAccountId: string;
  type: string;
}

export interface AccountCountResult {
  id: number;
}

// Database query result types
export interface UserQueryResult {
  id: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  passwordHash: string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserListQueryResult {
  id: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  isActive?: boolean;
}

export interface AccountQueryResult {
  id: number;
  userId: string;
  provider: string;
  providerAccountId: string;
  type: string;
}

// NOTE: The `DatabaseTransaction` interface that used to live here was a
// lying shim that pretended the adapter's positional TransactionContext
// (`tx.insert(table, data)`) matched Drizzle's fluent transaction API
// (`tx.insert(table).values(data)`). Every call site that cast through it
// would crash at runtime with `TypeError: Cannot convert undefined or null
// to object` because the shapes didn't line up. It has been removed.
//
// All services now route transactions through `BaseService.withTransaction`,
// which calls `this.db.transaction(fn)` (Drizzle native). Inside the
// callback, `tx` is a real dialect-specific Drizzle transaction
// (NodePgTransaction / MySql2Transaction / BetterSQLite3Transaction) with
// the same fluent query API as `this.db`. Type it as `any` in the callback
// parameter (BaseService yields `unknown`) because importing all three
// dialect-specific transaction types would bind the whole package to every
// driver and break tree-shaking.

// Database instance types
export interface DatabaseInstance {
  // The relational `query` namespace is deliberately absent. It described a
  // handful of core tables by name, so it could never answer about a plugin's
  // own tables, and the account entries it carried had no live consumer.
  // Reads go through the fluent API below, or through the typed services.
  update: (table: unknown) => {
    set: (data: unknown) => {
      where: (condition: unknown) => Promise<void>;
    };
  };
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<void>;
  };
  insert: (table: unknown) => {
    values: (data: unknown) => Promise<void>;
  };
  select: (columns: Record<string, boolean>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<unknown[]>;
    };
  };
}

// Minimal tables shape for AuthService usage
export interface AuthSchemaTables {
  users: {
    id: unknown;
    email: unknown;
  };
  passwordResetTokens: {
    id: unknown;
    identifier: unknown;
    tokenHash: unknown;
    expires: unknown;
    usedAt?: unknown;
  };
  emailVerificationTokens: {
    id: unknown;
    identifier: unknown;
    tokenHash: unknown;
    expires: unknown;
  };
  accounts: {
    id: unknown;
    userId: unknown;
    provider: unknown;
    providerAccountId: unknown;
  };
}
