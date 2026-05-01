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

// Architectural guard (task 24 stage 1): the package root must stay
// loadable in plain Node.js so the CLI, config loaders, and plugin
// authors can `import { ... } from "@revnixhq/nextly"` without
// dragging Next.js subpaths into a Node-only context.
//
// `dist/index.mjs` itself shouldn't have any `import "next/..."` at
// module top-level (only inside dynamically-loaded chunks). The check
// below loads the file in plain Node and fails the build if the
// import-chain crashes — which is precisely the regression we want to
// catch before publishing.
console.log("Verifying root entry loads in plain Node.js...");
require("child_process").execFileSync(
  process.execPath,
  [
    "-e",
    "import('./dist/index.mjs').then(() => process.exit(0)).catch(e => { console.error('[build-guard] Root entry crashed at load time:', e.message); process.exit(1); });",
  ],
  { cwd: join(__dirname, ".."), stdio: "inherit" }
);
console.log("Root entry is Node-safe.\n");
