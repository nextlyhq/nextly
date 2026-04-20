const { cpSync, existsSync } = require("fs");
const { join } = require("path");

// Copy migration files to dist after build
console.log("\nCopying migration files to dist...");
try {
  const rootDir = join(__dirname, "..");
  const postgresqlSrc = join(rootDir, "src/database/migrations/postgresql");
  const mysqlSrc = join(rootDir, "src/database/migrations/mysql");
  const sqliteSrc = join(rootDir, "src/database/migrations/sqlite");
  const postgresqlDest = join(rootDir, "dist/migrations/postgresql");
  const mysqlDest = join(rootDir, "dist/migrations/mysql");
  const sqliteDest = join(rootDir, "dist/migrations/sqlite");

  if (existsSync(postgresqlSrc)) {
    cpSync(postgresqlSrc, postgresqlDest, { recursive: true });
    console.log("PostgreSQL migrations copied");
  } else {
    console.warn("PostgreSQL migrations directory not found");
  }

  if (existsSync(mysqlSrc)) {
    cpSync(mysqlSrc, mysqlDest, { recursive: true });
    console.log("MySQL migrations copied");
  } else {
    console.warn("MySQL migrations directory not found");
  }

  if (existsSync(sqliteSrc)) {
    cpSync(sqliteSrc, sqliteDest, { recursive: true });
    console.log("SQLite migrations copied");
  } else {
    console.warn("SQLite migrations directory not found");
  }

  console.log("Migration files copied successfully\n");
} catch (error) {
  console.error("Failed to copy migration files:", error);
  process.exit(1);
}
