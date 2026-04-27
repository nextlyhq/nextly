import { cpSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "tsup";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Server-only entry points that need Node.js shims (__dirname, import.meta.url, etc.)
const serverEntries = [
  "src/index.ts",
  "src/scripts/load-env.ts",
  "src/api/health.ts",
  "src/api/media.ts",
  "src/api/media-bulk.ts",
  "src/api/media-folders.ts",
  "src/api/media-handlers.ts",
  "src/api/collections-schema.ts",
  "src/api/collections-schema-detail.ts",
  "src/api/collections-schema-export.ts",
  "src/api/components.ts",
  "src/api/components-detail.ts",
  "src/api/singles.ts",
  "src/api/singles-detail.ts",
  "src/api/singles-schema-detail.ts",
  "src/api/email-providers.ts",
  "src/api/email-providers-detail.ts",
  "src/api/email-providers-test.ts",
  "src/api/email-providers-default.ts",
  "src/api/email-templates.ts",
  "src/api/email-templates-detail.ts",
  "src/api/email-templates-preview.ts",
  "src/api/email-templates-layout.ts",
  "src/api/email-send.ts",
  "src/api/email-send-template.ts",
  "src/api/uploads.ts",
  "src/api/storage-upload-url.ts",
  "src/actions/index.ts",
  "src/cli/nextly.ts",
  "src/cli/utils/index.ts",
  "src/storage/index.ts",
  // Unified error system entry points (Task 21)
  "src/errors/index.ts",
  "src/observability/index.ts",
  "src/database/index.ts",
  "src/api/index.ts",
];

// Client-safe entry points that should NOT have Node.js shims
// These are imported in browser contexts (admin UI, client components)
const clientEntries = ["src/config.ts", "src/next.ts"];

// Shared config options
const sharedConfig = {
  format: ["esm"],
  outDir: "dist",
  sourcemap: false,
  tsconfig: "tsconfig.json",
  external: [
    // Database drivers — kept external (CJS native modules can't be bundled into ESM)
    "better-sqlite3",
    "pg",
    "mysql2",
    "mysql2/promise",
    "drizzle-orm",
    "drizzle-orm/better-sqlite3",
    "drizzle-orm/node-postgres",
    "drizzle-orm/mysql2",
    // drizzle-kit — dev/CLI tool, must not be bundled into production Next.js builds.
    // It imports esbuild and @libsql native binaries that Turbopack cannot parse.
    "drizzle-kit",
    "drizzle-kit/api",
    // Next.js - keep external to match user's version
    "next",
    "next/server",
    // React - keep external to match user's version
    "react",
    "react-dom",
    // Native binaries that can't be bundled
    "sharp",
    "esbuild",
    // Database adapter packages - installed separately based on user's DB choice
    "@revnixhq/adapter-drizzle",
    "@revnixhq/adapter-mysql",
    "@revnixhq/adapter-postgres",
    "@revnixhq/adapter-sqlite",
  ],
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".mjs",
    };
  },
};

// Combine all entries into a single build to avoid race conditions
// with parallel builds and the clean option
const allEntries = [...serverEntries, ...clientEntries];

export default defineConfig({
  ...sharedConfig,
  entry: allEntries,
  // DTS is generated via a separate `tsc -p tsconfig.dts.json` + rollup
  // pipeline in the build script (see package.json "build" and
  // rollup.dts.config.ts). Handling DTS here would OOM with 30+ parallel
  // rollup-plugin-dts workers each resolving the full type graph.
  dts: false,
  clean: true,
  // No shims — output is native ESM (.mjs). The __require shim generated
  // by shims:true throws "Dynamic require of X is not supported" for Node
  // builtins (events, net, etc.) when loaded by Turbopack on Vercel.
  // Code that needs __dirname already has ESM fallbacks via import.meta.url.
  shims: false,
  async onSuccess() {
    // Copy migration files to dist after build
    console.log("\nCopying migration files to dist...");
    try {
      const postgresqlSrc = join(
        __dirname,
        "src/database/migrations/postgresql"
      );
      const mysqlSrc = join(__dirname, "src/database/migrations/mysql");
      const sqliteSrc = join(__dirname, "src/database/migrations/sqlite");
      const postgresqlDest = join(__dirname, "dist/migrations/postgresql");
      const mysqlDest = join(__dirname, "dist/migrations/mysql");
      const sqliteDest = join(__dirname, "dist/migrations/sqlite");

      if (existsSync(postgresqlSrc)) {
        cpSync(postgresqlSrc, postgresqlDest, { recursive: true });
        console.log("PostgreSQL migrations copied");
      }

      if (existsSync(mysqlSrc)) {
        cpSync(mysqlSrc, mysqlDest, { recursive: true });
        console.log("MySQL migrations copied");
      }

      if (existsSync(sqliteSrc)) {
        cpSync(sqliteSrc, sqliteDest, { recursive: true });
        console.log("SQLite migrations copied");
      }

      console.log("Migration files copied successfully\n");
    } catch (error) {
      console.error("Failed to copy migration files:", error);
      throw error;
    }
  },
});
