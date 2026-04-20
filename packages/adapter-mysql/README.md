# @nextly/adapter-mysql

MySQL database adapter for Nextly. Extends `@nextly/adapter-drizzle` to provide MySQL-specific functionality using the `mysql2` driver.

## Overview

This adapter provides:

- Connection pooling via `mysql2` Pool
- Full transaction support with isolation levels
- CRUD operations with workarounds for missing RETURNING clause
- MySQL-specific error classification
- JSON type support
- FULLTEXT search capabilities
- SSL/TLS connection support
- Automatic retry for deadlocks

## Installation

```bash
pnpm add @nextly/adapter-mysql mysql2
```

Or with npm:

```bash
npm install @nextly/adapter-mysql mysql2
```

## Peer Dependencies

- `mysql2` (^3.0.0) - MySQL client for Node.js

## Quick Start

```typescript
import { createMySqlAdapter } from "@nextly/adapter-mysql";

const adapter = createMySqlAdapter({
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

| Option                     | Type                   | Default | Description                        |
| -------------------------- | ---------------------- | ------- | ---------------------------------- |
| `url`                      | `string`               | -       | MySQL connection URL               |
| `host`                     | `string`               | -       | Database host (alternative to URL) |
| `port`                     | `number`               | `3306`  | Database port                      |
| `database`                 | `string`               | -       | Database name                      |
| `user`                     | `string`               | -       | Database user                      |
| `password`                 | `string`               | -       | Database password                  |
| `pool.min`                 | `number`               | `2`     | Minimum pool connections           |
| `pool.max`                 | `number`               | `10`    | Maximum pool connections           |
| `pool.idleTimeoutMs`       | `number`               | `30000` | Idle connection timeout (ms)       |
| `pool.connectionTimeoutMs` | `number`               | `10000` | Connection timeout (ms)            |
| `ssl`                      | `boolean \| SslConfig` | -       | SSL/TLS configuration              |
| `timezone`                 | `string`               | -       | Session timezone                   |
| `charset`                  | `string`               | -       | Connection charset                 |

### Full Configuration Example

```typescript
import { createMySqlAdapter } from "@nextly/adapter-mysql";

const adapter = createMySqlAdapter({
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
  timezone: "+00:00",
  charset: "utf8mb4",
});

await adapter.connect();
```

## Database Capabilities

MySQL has some limitations compared to PostgreSQL:

| Capability        | Supported | Notes                           |
| ----------------- | --------- | ------------------------------- |
| JSON              | ✅        | Native JSON type                |
| JSONB             | ❌        | Use JSON instead                |
| Arrays            | ❌        | Not supported natively          |
| Full-text search  | ✅        | FULLTEXT indexes                |
| ILIKE             | ❌        | Uses `LOWER() LIKE` workaround  |
| RETURNING         | ❌        | Uses `INSERT` then `SELECT`     |
| Savepoints        | ⚠️        | Disabled for safety (see notes) |
| ON CONFLICT       | ✅        | `ON DUPLICATE KEY UPDATE`       |
| Generated columns | ✅        | MySQL 5.7.6+                    |

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

### Transaction with Isolation Level

```typescript
const result = await adapter.transaction(
  async tx => {
    const accounts = await tx.select("accounts", {
      where: { and: [{ column: "balance", op: ">", value: 1000 }] },
    });
    return accounts;
  },
  {
    isolationLevel: "repeatable read",
    retryCount: 3, // Retry on deadlocks
    retryDelayMs: 100,
  }
);
```

### Using the Adapter Class Directly

```typescript
import { MySqlAdapter } from "@nextly/adapter-mysql";
import type { MySqlAdapterConfig } from "@nextly/adapter-mysql";

const config: MySqlAdapterConfig = {
  url: process.env.DATABASE_URL!,
  pool: { max: 10 },
};

const adapter = new MySqlAdapter(config);
await adapter.connect();
```

## Error Handling

MySQL errors are automatically classified into `DatabaseError` types. See [`@nextly/adapter-drizzle`](../adapter-drizzle) for the full error handling API.

### MySQL Error Code Mapping

| MySQL Code | Error Kind              | Description                     |
| ---------- | ----------------------- | ------------------------------- |
| 1062       | `unique_violation`      | Duplicate entry                 |
| 1451, 1452 | `foreign_key_violation` | Foreign key constraint violated |
| 1048       | `not_null_violation`    | Column cannot be null           |
| 3819       | `check_violation`       | Check constraint violated       |
| 1213       | `deadlock`              | Deadlock detected               |
| 1205       | `timeout`               | Lock wait timeout               |
| 2002, 2003 | `connection`            | Connection errors               |

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
      case "deadlock":
        console.log("Deadlock detected, consider retrying");
        break;
      default:
        console.log(`Database error: ${error.message}`);
    }
  }
}
```

## Production Tips

- **Connection pooling:** Set `pool.max` based on workload; MySQL's default `max_connections` is 151
- **SSL:** Always enable SSL in production for secure connections
- **Timezone:** Set `timezone: "+00:00"` to store timestamps in UTC
- **Charset:** Use `charset: "utf8mb4"` for full Unicode support including emojis
- **Deadlock retries:** Use `retryCount` in transactions to handle transient deadlocks

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
import { isMySqlAdapter } from "@nextly/adapter-mysql";

if (isMySqlAdapter(adapter)) {
  // TypeScript knows adapter is MySqlAdapter
  console.log(adapter.dialect); // 'mysql'
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
  MySqlAdapterConfig,
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
} from "@nextly/adapter-mysql";
```

## MySQL-Specific Notes

### No RETURNING Clause

MySQL doesn't support the `RETURNING` clause. The adapter works around this by:

1. Executing the `INSERT` statement
2. Using `LAST_INSERT_ID()` to get the auto-increment ID
3. Executing a `SELECT` to retrieve the inserted row

This means `insert()` operations require two queries instead of one.

### Savepoints Disabled

Savepoints are disabled in this adapter due to MySQL's quirks with nested transactions. If you need savepoint-like behavior, consider:

- Restructuring your transaction logic
- Using PostgreSQL or SQLite which have full savepoint support

### ILIKE Emulation

MySQL doesn't have native `ILIKE`. The adapter uses `LOWER(column) LIKE LOWER(value)` as a workaround, which may impact index usage.

## Troubleshooting

### Connection refused

- Verify MySQL is running and accepting connections
- Check host, port, and firewall settings
- Ensure the database exists and user has access

### Access denied

- Verify username and password
- Check user privileges: `SHOW GRANTS FOR 'user'@'host'`

### Too many connections

- Reduce `pool.max` or increase MySQL's `max_connections`
- Ensure connections are being released (call `disconnect()` on shutdown)

### Deadlocks

- Use `retryCount` option in transactions
- Review query order to minimize lock contention
- Consider using `"read committed"` isolation level

### Character encoding issues

- Set `charset: "utf8mb4"` for full Unicode support
- Ensure your database and tables use `utf8mb4` collation

## Related Packages

- [`@nextly/adapter-drizzle`](../adapter-drizzle) - Base adapter with shared logic
- [`@nextly/adapter-postgres`](../adapter-postgres) - PostgreSQL adapter
- [`@nextly/adapter-sqlite`](../adapter-sqlite) - SQLite adapter

## License

MIT
