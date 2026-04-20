# @nextly/adapter-sqlite

SQLite database adapter for Nextly. Extends `@nextly/adapter-drizzle` to provide SQLite-specific functionality using the `better-sqlite3` driver.

## Overview

This adapter provides:

- Synchronous API wrapped for async interface compatibility
- Full transaction support with savepoints
- RETURNING clause support (SQLite 3.35+)
- SQLite-specific error classification
- WAL mode for better concurrent read performance
- In-memory and file-based database support
- JSON type support

## Installation

```bash
pnpm add @nextly/adapter-sqlite better-sqlite3
```

Or with npm:

```bash
npm install @nextly/adapter-sqlite better-sqlite3
```

## Peer Dependencies

- `better-sqlite3` (^11.0.0) - SQLite driver for Node.js

## Quick Start

```typescript
import { createSqliteAdapter } from "@nextly/adapter-sqlite";

// File-based database
const adapter = createSqliteAdapter({
  url: "file:./data.db",
});

await adapter.connect();

// Query data
const users = await adapter.select("users", {
  where: { and: [{ column: "status", op: "=", value: "active" }] },
  orderBy: [{ column: "created_at", direction: "desc" }],
  limit: 10,
});

await adapter.disconnect();
```

## Configuration Options

| Option        | Type            | Default | Description                                |
| ------------- | --------------- | ------- | ------------------------------------------ |
| `url`         | `string`        | -       | Path to SQLite database file or `:memory:` |
| `memory`      | `boolean`       | `false` | Use in-memory database                     |
| `readonly`    | `boolean`       | `false` | Open database in read-only mode            |
| `busyTimeout` | `number`        | `5000`  | Busy timeout in milliseconds               |
| `wal`         | `boolean`       | `true`  | Enable WAL mode (recommended)              |
| `foreignKeys` | `boolean`       | `true`  | Enable foreign key constraints             |
| `logger`      | `AdapterLogger` | -       | Optional logger for query logging          |

### Full Configuration Example

```typescript
import { createSqliteAdapter } from "@nextly/adapter-sqlite";

const adapter = createSqliteAdapter({
  url: "file:./data/app.db",
  wal: true,
  foreignKeys: true,
  busyTimeout: 10000,
  logger: {
    query: (sql, params, duration) =>
      console.log(`Query (${duration}ms): ${sql}`),
  },
});

await adapter.connect();
```

### In-Memory Database

```typescript
// Using memory option
const adapter = createSqliteAdapter({
  memory: true,
});

// Or using :memory: URL
const adapter = createSqliteAdapter({
  url: ":memory:",
});
```

## Database Capabilities

| Capability         | Supported | Notes                          |
| ------------------ | --------- | ------------------------------ |
| JSON               | ✅        | Native JSON support            |
| JSONB              | ❌        | SQLite uses JSON, not JSONB    |
| Arrays             | ❌        | No native array types          |
| Full-text search   | ✅        | FTS5                           |
| ILIKE              | ❌        | Uses `LOWER() LIKE` workaround |
| RETURNING          | ✅        | SQLite 3.35+                   |
| Savepoints         | ✅        | Full savepoint support         |
| ON CONFLICT        | ✅        | Native support                 |
| Generated columns  | ✅        | SQLite 3.31+                   |
| Connection pooling | ❌        | Single connection (file-based) |

## Usage Examples

### Transactions

```typescript
const result = await adapter.transaction(async tx => {
  // Insert a user
  const user = await tx.insert("users", {
    email: "user@example.com",
    name: "New User",
  });

  // Insert related data
  await tx.insert("profiles", {
    user_id: user.id,
    bio: "Hello world",
  });

  return user;
});
```

### Transactions with Savepoints

```typescript
await adapter.transaction(async tx => {
  await tx.insert("users", { email: "user1@test.com" });

  // Create a savepoint
  await tx.savepoint?.("before_second_insert");

  try {
    await tx.insert("users", { email: "user2@test.com" });
  } catch (error) {
    // Rollback to savepoint if needed
    await tx.rollbackToSavepoint?.("before_second_insert");
  }
});
```

### Using the Adapter Class Directly

```typescript
import { SqliteAdapter } from "@nextly/adapter-sqlite";
import type { SqliteAdapterConfig } from "@nextly/adapter-sqlite";

const config: SqliteAdapterConfig = {
  url: "file:./data.db",
  wal: true,
};

const adapter = new SqliteAdapter(config);
await adapter.connect();
```

## Error Handling

SQLite errors are automatically classified into `DatabaseError` types. See [`@nextly/adapter-drizzle`](../adapter-drizzle) for the full error handling API.

### SQLite Error Code Mapping

| SQLite Code                  | Error Kind              | Description                  |
| ---------------------------- | ----------------------- | ---------------------------- |
| SQLITE_CONSTRAINT_UNIQUE     | `unique_violation`      | Unique constraint violated   |
| SQLITE_CONSTRAINT_PRIMARYKEY | `unique_violation`      | Primary key violated         |
| SQLITE_CONSTRAINT_FOREIGNKEY | `foreign_key_violation` | Foreign key violated         |
| SQLITE_CONSTRAINT_NOTNULL    | `not_null_violation`    | NOT NULL constraint violated |
| SQLITE_CONSTRAINT_CHECK      | `check_violation`       | Check constraint violated    |
| SQLITE_BUSY                  | `timeout`               | Database is busy             |
| SQLITE_LOCKED                | `timeout`               | Database is locked           |
| SQLITE_CANTOPEN              | `connection`            | Cannot open database file    |

### Error Handling Example

```typescript
import { isDatabaseError } from "@nextly/adapter-drizzle/types";

try {
  await adapter.insert("users", { email: "duplicate@example.com" });
} catch (error) {
  if (isDatabaseError(error)) {
    switch (error.kind) {
      case "unique_violation":
        console.log(`Duplicate entry: ${error.message}`);
        break;
      case "timeout":
        console.log("Database is busy, try again");
        break;
      default:
        console.log(`Database error: ${error.message}`);
    }
  }
}
```

## Production Tips

- **WAL mode:** Always enable WAL mode (`wal: true`) for better concurrent read performance
- **Busy timeout:** Increase `busyTimeout` if you experience "database is locked" errors
- **Foreign keys:** Keep `foreignKeys: true` to enforce referential integrity
- **File permissions:** Ensure the application has read/write access to the database file and directory
- **Backups:** Use `.backup()` or copy the database file for backups (WAL files too if in WAL mode)

## Advanced Usage

### Drizzle Access

Access the underlying Drizzle ORM instance for advanced queries:

```typescript
const db = adapter.getDrizzle(schema);

// Use Drizzle's query builder
const users = await db
  .select()
  .from(usersTable)
  .where(eq(usersTable.status, "active"));
```

### Type Guard

```typescript
import { isSqliteAdapter } from "@nextly/adapter-sqlite";

if (isSqliteAdapter(adapter)) {
  // TypeScript knows adapter is SqliteAdapter
  console.log(adapter.dialect); // 'sqlite'
}
```

## Type Exports

This package re-exports commonly used types from `@nextly/adapter-drizzle`:

```typescript
import type {
  SqliteAdapterConfig,
  DatabaseCapabilities,
  TransactionContext,
  TransactionOptions,
  WhereClause,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  DatabaseError,
  DatabaseErrorKind,
} from "@nextly/adapter-sqlite";
```

## SQLite-Specific Notes

### Synchronous API

SQLite with `better-sqlite3` uses a synchronous API under the hood. The adapter wraps this in async methods for consistency with other adapters (PostgreSQL, MySQL). This makes it easy to switch between databases without code changes.

### Transaction Modes

SQLite uses DEFERRED, IMMEDIATE, or EXCLUSIVE transaction modes rather than isolation levels. The adapter uses IMMEDIATE by default for better write performance.

### WAL Mode

For better concurrent read performance, enable WAL (Write-Ahead Logging) mode. This is enabled by default (`wal: true`). Benefits:

- Multiple readers can access the database simultaneously
- Writers don't block readers
- Better crash recovery

Note: WAL mode creates additional files (`-wal` and `-shm`) alongside your database.

### In-Memory Databases

Use `:memory:` or `memory: true` for in-memory databases. These are perfect for:

- Testing
- Temporary data processing
- Caching

Note: Data is lost when the connection closes.

### No Connection Pooling

Unlike PostgreSQL and MySQL, SQLite doesn't use connection pooling. The adapter manages a single database connection. This means:

- `getPoolStats()` returns `null`
- Concurrency is handled by SQLite's locking mechanism
- WAL mode helps with read concurrency

## Troubleshooting

### Database is locked

- Increase `busyTimeout` to wait longer for locks
- Enable WAL mode for better concurrency
- Ensure only one process writes at a time

### Cannot open database file

- Verify the file path is correct
- Check file permissions (read/write for the user)
- Ensure the parent directory exists

### Foreign key constraint failed

- Ensure `foreignKeys: true` is set (default)
- Verify referenced rows exist before inserting
- Check cascade rules on your schema

### SQLITE_BUSY errors

- The database is being written to by another connection
- Increase `busyTimeout` to retry longer
- Consider using WAL mode for better concurrency

### Data not persisting

- If using `:memory:`, data is lost on disconnect
- Ensure you're using a file path, not `:memory:`
- Check file write permissions

## Related Packages

- [`@nextly/adapter-drizzle`](../adapter-drizzle) - Base adapter with shared logic
- [`@nextly/adapter-postgres`](../adapter-postgres) - PostgreSQL adapter
- [`@nextly/adapter-mysql`](../adapter-mysql) - MySQL adapter

## License

MIT
