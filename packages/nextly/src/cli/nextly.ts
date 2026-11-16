#!/usr/bin/env node
/**
 * Nextly CLI
 *
 * Command-line interface for managing Nextly applications.
 * Provides commands for database migrations, schema management,
 * type generation, and development workflow.
 *
 * @remarks
 * This CLI uses Commander.js for command parsing and provides:
 * - Global options: --config, --verbose, --quiet, --cwd, --mode, --no-color
 * - Project commands: init, build, db:sync (alias: sync)
 * - Type generation: generate:types, generate:schema
 * - Migration commands: migrate, migrate:create, migrate:status,
 *   migrate:check, migrate:down, migrate:resolve, migrate:fresh,
 *   migrate:baseline
 *
 * There is no `nextly dev` command: user apps run their own dev server
 * (`next dev`), and schema changes apply in-process via the HMR listener.
 *
 * @example
 * ```bash
 * # Sync the database schema with nextly.config.ts
 * npx nextly db:sync
 *
 * # Generate TypeScript types
 * npx nextly generate:types
 *
 * # Run pending migrations
 * npx nextly migrate
 *
 * # Check migration status
 * npx nextly migrate:status
 *
 * # Create a new migration
 * npx nextly migrate:create add_posts_table
 * ```
 *
 * @packageDocumentation
 */

import { runCli } from "./run";

// The mode, its environment files and then the program: `runCli` reads the
// files before any application module is imported.
runCli(process.argv).catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
