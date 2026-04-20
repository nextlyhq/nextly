# @nextly/adapter-drizzle

Shared Drizzle ORM adapter logic for Nextly database adapters. This package provides the base adapter class, types, query builder, and migration utilities used by dialect-specific adapters.

## Overview

This package serves as the foundation for all Nextly database adapters:

- [`@nextly/adapter-postgres`](../adapter-postgres) - PostgreSQL adapter
- [`@nextly/adapter-mysql`](../adapter-mysql) - MySQL adapter
- [`@nextly/adapter-sqlite`](../adapter-sqlite) - SQLite adapter

**For most users:** You don't need to install this package directly. Install one of the dialect-specific adapters above instead.

**For adapter developers:** This package provides the base class and utilities needed to create custom database adapters.

## Features

- **DrizzleAdapter Base Class** - Abstract class with default CRUD implementations
- **Query Builder** - Fluent, type-safe query builder with immutable API
- **Migration Utilities** - Checksum validation, sorting, and execution helpers
- **Comprehensive Types** - Full TypeScript definitions for all operations
- **Schema Utilities** - Database-agnostic schema type definitions
- **Dialect-Agnostic** - Works across PostgreSQL, MySQL, and SQLite

## Installation

```bash
pnpm add @nextly/adapter-drizzle drizzle-orm
```

Or with npm:

```bash
npm install @nextly/adapter-drizzle drizzle-orm
```

## Peer Dependencies

- `drizzle-orm` (>=0.44.0) - Drizzle ORM

## Package Exports

This package uses subpath exports for optimal tree-shaking:

| Export Path       | Description                       |
| ----------------- | --------------------------------- |
| `.`               | Main entry - DrizzleAdapter class |
| `./types`         | Type definitions                  |
| `./query-builder` | QueryBuilder utility class        |
| `./migrations`    | Migration utilities               |
| `./schema`        | Schema type definitions           |

---

## For End Users

### Understanding the Adapter Pattern

Nextly uses an adapter pattern for database access. You configure which database to use via environment variables:

```bash
# PostgreSQL
DB_DIALECT=postgresql
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# MySQL
DB_DIALECT=mysql
DATABASE_URL=mysql://user:pass@localhost:3306/mydb

# SQLite
DB_DIALECT=sqlite
DATABASE_URL=file:./data/mydb.db
```

The appropriate adapter is automatically loaded based on `DB_DIALECT`.

### Accessing the Adapter

If you need direct access to the adapter (advanced usage):

```typescript
import { getNextly } from "nextly";

const nextly = await getNextly(config);

// Access the adapter directly
const adapter = nextly.adapter;

// Check database capabilities
const capabilities = adapter.getCapabilities();
console.log(`Using ${capabilities.dialect}`);
console.log(`JSONB support: ${capabilities.supportsJsonb}`);
```

### Database Capabilities

Different databases support different features:

| Capability        | PostgreSQL | MySQL | SQLite |
| ----------------- | ---------- | ----- | ------ |
| JSONB             | ✅         | ❌    | ❌     |
| JSON              | ✅         | ✅    | ✅     |
| Arrays            | ✅         | ❌    | ❌     |
| Full-text search  | ✅         | ⚠️    | ❌     |
| ILIKE             | ✅         | ❌    | ❌     |
| RETURNING         | ✅         | ❌    | ✅     |
| Savepoints        | ✅         | ❌    | ✅     |
| ON CONFLICT       | ✅         | ✅    | ✅     |
| Generated columns | ✅         | ✅    | ✅     |

---

## For Adapter Developers

### Creating a Custom Adapter

To create a custom database adapter, extend the `DrizzleAdapter` class:

```typescript
import { DrizzleAdapter } from "@nextly/adapter-drizzle";
import type {
  DatabaseCapabilities,
  SqlParam,
  TransactionContext,
  TransactionOptions,
} from "@nextly/adapter-drizzle/types";

export class MyCustomAdapter extends DrizzleAdapter {
  // Required: Specify the dialect
  readonly dialect = "postgresql" as const;

  // Required: Establish connection
  async connect(): Promise<void> {
    // Your connection logic
  }

  // Required: Close connection
  async disconnect(): Promise<void> {
    // Your disconnection logic
  }

  // Required: Execute raw SQL
  async executeQuery<T = unknown>(
    sql: string,
    params?: SqlParam[]
  ): Promise<T[]> {
    // Your query execution logic
    return [];
  }

  // Required: Transaction support
  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    // Your transaction logic
  }

  // Required: Report capabilities
  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "postgresql",
      supportsJsonb: true,
      supportsJson: true,
      supportsArrays: true,
      supportsGeneratedColumns: true,
      supportsFts: true,
      supportsIlike: true,
      supportsReturning: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      maxParamsPerQuery: 65535,
      maxIdentifierLength: 63,
    };
  }
}
```

### Abstract Methods to Implement

| Method              | Description                            |
| ------------------- | -------------------------------------- |
| `dialect`           | Database dialect identifier (readonly) |
| `connect()`         | Establish database connection          |
| `disconnect()`      | Close database connection              |
| `executeQuery()`    | Execute raw SQL with parameters        |
| `transaction()`     | Execute work within a transaction      |
| `getCapabilities()` | Report supported database features     |

### Default CRUD Methods (Overridable)

The base class provides default implementations for CRUD operations. Override these for optimization:

| Method         | Description            | Override When                       |
| -------------- | ---------------------- | ----------------------------------- |
| `select()`     | Query multiple records | Dialect-specific optimizations      |
| `selectOne()`  | Query single record    | Custom null handling                |
| `insert()`     | Insert single record   | Custom RETURNING handling           |
| `insertMany()` | Bulk insert records    | Batch optimization                  |
| `update()`     | Update records         | Custom RETURNING handling           |
| `delete()`     | Delete records         | Custom cascade handling             |
| `upsert()`     | Insert or update       | Dialect-specific ON CONFLICT syntax |

### Protected Query Builders

Use these protected methods to build dialect-specific SQL:

```typescript
// In your adapter class
async select<T>(table: string, options?: SelectOptions): Promise<T[]> {
  const { sql, params } = this.buildSelectQuery(table, options);
  return this.executeQuery<T>(sql, params);
}
```

Available builders:

- `buildSelectQuery()` - SELECT with WHERE, ORDER BY, LIMIT, OFFSET
- `buildInsertQuery()` - INSERT with RETURNING support
- `buildUpdateQuery()` - UPDATE with WHERE and RETURNING
- `buildDeleteQuery()` - DELETE with WHERE
- `buildUpsertQuery()` - ON CONFLICT / ON DUPLICATE KEY
- `buildWhereClause()` - Recursive WHERE clause building

### Placeholder Overrides

Override these for dialect-specific placeholder syntax:

```typescript
// MySQL uses ? instead of $1, $2
protected buildPlaceholder(index: number): string {
  return "?";
}

// MySQL uses backticks instead of double quotes
protected escapeIdentifier(name: string): string {
  return `\`${name}\``;
}
```

---

## API Reference

### Main Export (`.`)

```typescript
import { DrizzleAdapter, version } from "@nextly/adapter-drizzle";
```

| Export           | Type     | Description                     |
| ---------------- | -------- | ------------------------------- |
| `DrizzleAdapter` | Class    | Abstract base adapter class     |
| `version`        | `string` | Package version (e.g., "0.1.0") |

### Types (`./types`)

```typescript
import type {
  // Core types
  SupportedDialect,
  SqlParam,
  JsonValue,

  // Query building
  WhereClause,
  WhereCondition,
  WhereOperator,
  OrderBySpec,
  JoinSpec,

  // CRUD options
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,

  // Transactions
  TransactionContext,
  TransactionOptions,
  TransactionIsolationLevel,

  // Capabilities
  DatabaseCapabilities,
  PoolStats,

  // Configuration
  BaseAdapterConfig,
  PostgresAdapterConfig,
  MySqlAdapterConfig,
  SqliteAdapterConfig,

  // Errors
  DatabaseError,
  DatabaseErrorKind,

  // Migrations
  Migration,
  MigrationRecord,
  MigrationResult,

  // Schema
  TableDefinition,
  ColumnDefinition,
  IndexDefinition,
} from "@nextly/adapter-drizzle/types";
```

### Query Builder (`./query-builder`)

```typescript
import { QueryBuilder } from "@nextly/adapter-drizzle/query-builder";

// SELECT query
const users = await QueryBuilder.select<User>("users")
  .columns(["id", "email", "name"])
  .where("status", "=", "active")
  .where("role", "IN", ["admin", "moderator"])
  .orderBy("created_at", "desc")
  .limit(10)
  .offset(20)
  .execute(adapter);

// INSERT query
const newUser = await QueryBuilder.insert<User>("users")
  .values({ email: "user@example.com", name: "New User" })
  .returning("*")
  .execute(adapter);

// UPDATE query
const updated = await QueryBuilder.update<User>("users")
  .set({ status: "inactive" })
  .where("last_login", "<", thirtyDaysAgo)
  .returning("*")
  .execute(adapter);

// DELETE query
const deleted = await QueryBuilder.delete("users")
  .where("status", "=", "deleted")
  .execute(adapter);

// UPSERT query
const upserted = await QueryBuilder.upsert<User>("users")
  .values({ email: "user@example.com", name: "User" })
  .onConflict(["email"], "update", ["name"])
  .returning("*")
  .execute(adapter);
```

**Key Features:**

- Immutable API - each method returns a new instance
- Type-safe with generics
- Supports all 15 WHERE operators
- Chainable and forkable queries

### Migrations (`./migrations`)

```typescript
import {
  // Core utilities
  calculateChecksum,
  sortMigrations,
  filterPending,
  filterApplied,
  validateChecksum,
  detectModified,
  getMigrationStatus,
  validateMigrations,

  // Adapter helpers
  migrationHelpers,
} from "@nextly/adapter-drizzle/migrations";

// Calculate migration checksum
const checksum = calculateChecksum(migration);

// Sort migrations by timestamp
const sorted = sortMigrations(migrations);

// Get pending migrations
const pending = filterPending(migrations, appliedRecords);

// Validate all migrations
const { valid, errors, warnings } = validateMigrations(migrations, records);

// Adapter helpers (for building adapters)
const { createMigrationsTable, recordMigration, getAppliedMigrations } =
  migrationHelpers;
```

### Schema (`./schema`)

```typescript
import type {
  TableDefinition,
  ColumnDefinition,
  IndexDefinition,
  AlterTableOperation,
  CreateTableOptions,
  DropTableOptions,
} from "@nextly/adapter-drizzle/schema";

// Define a table
const usersTable: TableDefinition = {
  name: "users",
  columns: [
    { name: "id", type: "uuid", primaryKey: true },
    { name: "email", type: "varchar(255)", unique: true },
    { name: "created_at", type: "timestamp", default: { sql: "NOW()" } },
  ],
  indexes: [{ name: "users_email_idx", columns: ["email"], unique: true }],
};
```

---

## WHERE Operators

The query builder and adapter support these operators:

| Operator      | Example                                                         | Description                |
| ------------- | --------------------------------------------------------------- | -------------------------- |
| `=`           | `{ column: "id", op: "=", value: 1 }`                           | Equal                      |
| `!=`          | `{ column: "status", op: "!=", value: "deleted" }`              | Not equal                  |
| `<`           | `{ column: "age", op: "<", value: 18 }`                         | Less than                  |
| `>`           | `{ column: "price", op: ">", value: 100 }`                      | Greater than               |
| `<=`          | `{ column: "qty", op: "<=", value: 0 }`                         | Less than or equal         |
| `>=`          | `{ column: "rating", op: ">=", value: 4 }`                      | Greater than or equal      |
| `IN`          | `{ column: "status", op: "IN", value: ["a", "b"] }`             | In array                   |
| `NOT IN`      | `{ column: "id", op: "NOT IN", value: [1, 2] }`                 | Not in array               |
| `LIKE`        | `{ column: "name", op: "LIKE", value: "%john%" }`               | Pattern match              |
| `ILIKE`       | `{ column: "email", op: "ILIKE", value: "%@gmail%" }`           | Case-insensitive (PG only) |
| `IS NULL`     | `{ column: "deleted_at", op: "IS NULL" }`                       | Is null                    |
| `IS NOT NULL` | `{ column: "verified_at", op: "IS NOT NULL" }`                  | Is not null                |
| `BETWEEN`     | `{ column: "date", op: "BETWEEN", value: start, valueTo: end }` | Range                      |
| `CONTAINS`    | `{ column: "tags", op: "CONTAINS", value: "featured" }`         | JSON contains              |
| `OVERLAPS`    | `{ column: "categories", op: "OVERLAPS", value: [1, 2] }`       | Array overlap              |

---

## Error Handling

The adapter provides structured error handling:

```typescript
import type {
  DatabaseError,
  DatabaseErrorKind,
} from "@nextly/adapter-drizzle/types";
import {
  isDatabaseError,
  createDatabaseError,
} from "@nextly/adapter-drizzle/types";

try {
  await adapter.insert("users", { email: "duplicate@example.com" });
} catch (error) {
  if (isDatabaseError(error)) {
    switch (error.kind) {
      case "unique_violation":
        console.log(`Duplicate value in ${error.column}`);
        break;
      case "foreign_key_violation":
        console.log(`Invalid reference to ${error.table}`);
        break;
      case "not_null_violation":
        console.log(`Missing required field: ${error.column}`);
        break;
      case "connection":
        console.log("Database connection failed");
        break;
      default:
        console.log(`Database error: ${error.message}`);
    }
  }
}
```

**Error Kinds:**

- `connection` - Connection failures
- `query` - Query syntax errors
- `constraint` - General constraint violations
- `unique_violation` - Unique constraint violated
- `foreign_key_violation` - Foreign key constraint violated
- `check_violation` - Check constraint violated
- `not_null_violation` - NOT NULL constraint violated
- `deadlock` - Deadlock detected
- `timeout` - Query timeout
- `serialization_failure` - Transaction serialization failure

---

## Development

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Watch mode
pnpm dev

# Type checking
pnpm check-types

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

## Related Packages

- [`@nextly/adapter-postgres`](../adapter-postgres) - PostgreSQL adapter
- [`@nextly/adapter-mysql`](../adapter-mysql) - MySQL adapter
- [`@nextly/adapter-sqlite`](../adapter-sqlite) - SQLite adapter
- [`nextly`](../nextly) - Main Nextly package

## License

MIT
