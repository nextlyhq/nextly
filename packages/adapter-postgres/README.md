# @nextly/adapter-postgres

PostgreSQL database adapter for Nextly. Extends `@nextly/adapter-drizzle` to provide PostgreSQL-specific functionality using the `pg` (node-postgres) driver.

## Overview

This adapter provides:

- Connection pooling via `pg.Pool`
- Full transaction support with savepoints
- RETURNING clause support for all CRUD operations
- PostgreSQL-specific error classification
- JSONB and array type support
- Full-text search capabilities (ILIKE, tsvector)
- SSL/TLS connection support
- Automatic retry for serialization failures and deadlocks

## Installation

```bash
pnpm add @nextly/adapter-postgres pg
```

Or with npm:

```bash
npm install @nextly/adapter-postgres pg
```

## Peer Dependencies

- `pg` (^8.0.0) - PostgreSQL client for Node.js

## Quick Start

```typescript
import { createPostgresAdapter } from "@nextly/adapter-postgres";

const adapter = createPostgresAdapter({
  url: process.env.DATABASE_URL!,
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

| Option                     | Type                   | Default    | Description                              |
| -------------------------- | ---------------------- | ---------- | ---------------------------------------- |
| `url`                      | `string`               | -          | PostgreSQL connection URL                |
| `host`                     | `string`               | -          | Database host (alternative to URL)       |
| `port`                     | `number`               | `5432`     | Database port                            |
| `database`                 | `string`               | -          | Database name                            |
| `user`                     | `string`               | -          | Database user                            |
| `password`                 | `string`               | -          | Database password                        |
| `pool.min`                 | `number`               | `2`        | Minimum pool connections                 |
| `pool.max`                 | `number`               | `10`       | Maximum pool connections                 |
| `pool.idleTimeoutMs`       | `number`               | `30000`    | Idle connection timeout (ms)             |
| `pool.connectionTimeoutMs` | `number`               | `10000`    | Connection timeout (ms)                  |
| `ssl`                      | `boolean \| SslConfig` | -          | SSL/TLS configuration                    |
| `schema`                   | `string`               | `"public"` | PostgreSQL schema name                   |
| `applicationName`          | `string`               | -          | Application name for connection tracking |
| `statementTimeout`         | `number`               | -          | Statement timeout (ms)                   |
| `queryTimeout`             | `number`               | -          | Query timeout (ms)                       |

### Full Configuration Example

```typescript
import { createPostgresAdapter } from "@nextly/adapter-postgres";

const adapter = createPostgresAdapter({
  url: process.env.DATABASE_URL!,
  pool: {
    min: 2,
    max: 20,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 10000,
  },
  ssl: {
    rejectUnauthorized: true,
    ca: process.env.CA_CERT,
  },
  applicationName: "my-nextly-app",
  statementTimeout: 30000,
});

await adapter.connect();
```

## Database Capabilities

PostgreSQL provides the most comprehensive feature set:

| Capability        | Supported | Notes                           |
| ----------------- | --------- | ------------------------------- |
| JSONB             | ✅        | Native JSONB with indexing      |
| JSON              | ✅        | Native JSON type                |
| Arrays            | ✅        | Native array types              |
| Full-text search  | ✅        | tsvector, ILIKE                 |
| ILIKE             | ✅        | Case-insensitive pattern match  |
| RETURNING         | ✅        | All CRUD operations             |
| Savepoints        | ✅        | Full nested transaction support |
| ON CONFLICT       | ✅        | Upsert support                  |
| Generated columns | ✅        | Computed columns                |

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
  await tx.insert("users", { email: "user1@example.com" });

  // Create a savepoint
  await tx.savepoint?.("before_risky_operation");

  try {
    await tx.insert("users", { email: "duplicate@example.com" });
  } catch (error) {
    // Rollback to savepoint, keeping user1
    await tx.rollbackToSavepoint?.("before_risky_operation");
  }
});
```

### Transaction with Isolation Level

```typescript
const result = await adapter.transaction(
  async tx => {
    // Serializable isolation prevents phantom reads
    const accounts = await tx.select("accounts", {
      where: { and: [{ column: "balance", op: ">", value: 1000 }] },
    });
    return accounts;
  },
  {
    isolationLevel: "serializable",
    retryCount: 3, // Retry on serialization failures
    retryDelayMs: 100,
  }
);
```

## Error Handling

PostgreSQL errors are automatically classified into `DatabaseError` types. See [`@nextly/adapter-drizzle`](../adapter-drizzle) for the full error handling API.

### PostgreSQL Error Code Mapping

| PostgreSQL Code | Error Kind              | Description                     |
| --------------- | ----------------------- | ------------------------------- |
| 23505           | `unique_violation`      | Unique constraint violated      |
| 23503           | `foreign_key_violation` | Foreign key constraint violated |
| 23502           | `not_null_violation`    | NOT NULL constraint violated    |
| 23514           | `check_violation`       | Check constraint violated       |
| 40001           | `serialization_failure` | Transaction serialization fail  |
| 40P01           | `deadlock`              | Deadlock detected               |
| 57014           | `timeout`               | Query timeout                   |
| 08xxx           | `connection`            | Connection errors               |

### Error Handling Example

```typescript
import { isDatabaseError } from "@nextly/adapter-drizzle/types";

try {
  await adapter.insert("users", { email: "duplicate@example.com" });
} catch (error) {
  if (isDatabaseError(error)) {
    switch (error.kind) {
      case "unique_violation":
        console.log(`Duplicate: ${error.constraint}`);
        break;
      case "foreign_key_violation":
        console.log(`Invalid reference: ${error.detail}`);
        break;
      default:
        console.log(`Database error: ${error.message}`);
    }
  }
}
```

## Production Tips

- **Connection pooling:** Set `pool.max` based on your workload. A good starting point is `(CPU cores * 2) + 1`
- **SSL:** Always enable SSL in production with `ssl: { rejectUnauthorized: true }`
- **Statement timeout:** Set `statementTimeout` to prevent long-running queries from blocking resources
- **Application name:** Set `applicationName` to identify connections in `pg_stat_activity`
- **Retries:** Use `retryCount` in transactions to handle transient serialization failures

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
import { isPostgresAdapter } from "@nextly/adapter-postgres";

if (isPostgresAdapter(adapter)) {
  // TypeScript knows adapter is PostgresAdapter
  console.log(adapter.dialect); // 'postgresql'
}
```

### Pool Statistics

```typescript
const stats = adapter.getPoolStats();
if (stats) {
  console.log(
    `Active: ${stats.active}, Idle: ${stats.idle}, Waiting: ${stats.waiting}`
  );
}
```

## Type Exports

This package re-exports commonly used types from `@nextly/adapter-drizzle`:

```typescript
import type {
  PostgresAdapterConfig,
  DatabaseCapabilities,
  PoolStats,
  TransactionContext,
  TransactionOptions,
  WhereClause,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  DatabaseError,
  DatabaseErrorKind,
} from "@nextly/adapter-postgres";
```

## Troubleshooting

### Connection refused

- Verify PostgreSQL is running and accepting connections
- Check host, port, and firewall settings
- Ensure the database exists and user has access

### SSL certificate errors

- Set `ssl.rejectUnauthorized: false` for self-signed certificates (not recommended for production)
- Provide the CA certificate via `ssl.ca`

### Too many connections

- Reduce `pool.max` or increase PostgreSQL's `max_connections`
- Ensure connections are being released (call `disconnect()` on shutdown)

### Serialization failures

- Use `retryCount` option in transactions
- Consider using `"read committed"` isolation level if serializable is not required

## Related Packages

- [`@nextly/adapter-drizzle`](../adapter-drizzle) - Base adapter with shared logic
- [`@nextly/adapter-mysql`](../adapter-mysql) - MySQL adapter
- [`@nextly/adapter-sqlite`](../adapter-sqlite) - SQLite adapter

## License

MIT
