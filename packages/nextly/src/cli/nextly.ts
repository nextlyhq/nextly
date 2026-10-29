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
 * - Global options: --config, --verbose, --quiet, --cwd, --no-color
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

import { existsSync } from "fs";
import { join } from "path";

import { config } from "dotenv";

// Load environment variables from .env file in current working directory.
// This MUST happen before any application module is imported because those
// modules may read process.env during initialisation (e.g. env validation).
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main CLI entry point
 *
 * Uses dynamic import() for createProgram so that all application modules
 * (and their transitive dependencies) are loaded AFTER dotenv has populated
 * process.env. Static ESM imports are hoisted and evaluated before the
 * module body, which would cause env validation to fire before dotenv runs.
 */
async function main(): Promise<void> {
  const { createProgram } = await import("./program");
  const { reportCliError } = await import("./errors/index");
  const telemetry = await import("@nextlyhq/telemetry");

  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // Best-effort telemetry: capture a typed failure event with no raw
    // message or stack. Wrapped so a telemetry failure can never mask the
    // underlying user-visible error.
    try {
      telemetry.capture("command_failed", {
        command: process.argv[2] ?? "unknown",
        duration_ms: 0,
        error_code: telemetry.classifyError(error, "other"),
      });
      await telemetry.shutdown();
    } catch {
      // Swallow.
    }

    // Commander's own errors (a missing argument, an unknown option) were already printed by
    // Commander, with its help hint; anything else is printed in the error shape, with the
    // run's `--verbose`.
    const commanderError =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("commander.");
    if (!commanderError) {
      const globals = program.opts<{ verbose?: boolean }>();
      reportCliError(error, { verbose: globals.verbose === true });
    }

    process.exit(1);
  }
}

// Run the CLI
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
