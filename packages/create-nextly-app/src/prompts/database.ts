import type { DatabaseConfig, DatabaseType } from "../types";

/**
 * Database configuration presets
 */
export const DATABASE_CONFIGS: Record<
  DatabaseType,
  Omit<DatabaseConfig, "type">
> = {
  postgresql: {
    adapter: "@revnixhq/adapter-postgres",
    databaseDriver: "pg",
    connectionUrl: "postgresql://user:password@localhost:5432/nextly",
    envExample: "postgresql://user:password@localhost:5432/nextly",
  },
  mysql: {
    adapter: "@revnixhq/adapter-mysql",
    databaseDriver: "mysql2",
    connectionUrl: "mysql://user:password@localhost:3306/nextly",
    envExample: "mysql://user:password@localhost:3306/nextly",
  },
  sqlite: {
    adapter: "@revnixhq/adapter-sqlite",
    databaseDriver: "better-sqlite3",
    connectionUrl: "file:./data/nextly.db",
    envExample: "file:./data/nextly.db",
  },
};

/**
 * Labels shown in the CLI select prompt for each database type.
 */
export const DATABASE_LABELS: Record<
  DatabaseType,
  { label: string; hint: string }
> = {
  sqlite: {
    label: "SQLite",
    hint: "Perfect for trying out Nextly or local development",
  },
  postgresql: {
    label: "PostgreSQL",
    hint: "Recommended for production",
  },
  mysql: {
    label: "MySQL",
    hint: "Popular alternative for production",
  },
};
