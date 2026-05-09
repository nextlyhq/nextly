// Database operation types for better type safety

export interface UserInsertData {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerified: Date | null;
  image: string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserUpdateData {
  email?: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
  passwordHash?: string;
  isActive?: boolean;
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
  query: {
    users: {
      findMany: (options: {
        columns: Record<string, boolean>;
        where?: unknown;
      }) => Promise<UserQueryResult[]>;
      findFirst: (options: {
        where?: unknown;
        columns: Record<string, boolean>;
      }) => Promise<UserQueryResult | undefined>;
    };
    accounts: {
      findMany: (options: {
        where?: unknown;
        columns: Record<string, boolean>;
      }) => Promise<AccountQueryResult[]>;
    };
    passwordResetTokens: {
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<
        | {
            id: string;
            identifier: string;
            expires: Date;
          }
        | undefined
      >;
    };
    emailVerificationTokens: {
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<
        | {
            id: string;
            identifier: string;
            expires: Date;
          }
        | undefined
      >;
    };
  };
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
  verificationTokens: {
    id?: unknown;
    expires: unknown;
  };
  accounts: {
    id: unknown;
    userId: unknown;
    provider: unknown;
    providerAccountId: unknown;
  };
}
