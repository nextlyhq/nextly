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
 *   migrate:check, migrate:down, migrate:resolve, migrate:fresh
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
  const { createLogger } = await import("./utils/logger");
  const { NextlyError, describeError } = await import("../errors/index");
  const telemetry = await import("@nextlyhq/telemetry");

  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const logger = createLogger();

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

    const debugMode = process.env.DEBUG === "true" || process.env.DEBUG === "1";

    if (NextlyError.is(error)) {
      // CLI is operator-facing — print publicMessage as the headline, then the
      // full description (code, cause chain, logContext) so the terminal
      // carries what the wire deliberately withholds. cause.stack only under
      // DEBUG=true per existing convention.
      // describeError already leads with the public message, so printing it
      // separately would say the same thing twice.
      logger.error(describeError(error));
      if (debugMode && error.cause?.stack) {
        logger.newline();
        console.error(error.cause.stack);
      }
    } else if (error instanceof Error) {
      // Check if this is a Commander error (user input error)
      if ("code" in error) {
        // Commander errors (e.g., missing required argument)
        // are already handled by Commander's error display
        process.exit(1);
      }

      // Application error. describeError adds any `cause` chain, which a bare
      // `error.message` drops.
      logger.error(describeError(error));

      // Show stack trace in debug mode
      if (debugMode) {
        logger.newline();
        console.error(error.stack);
      }
    } else {
      // Non-Error throwables still get rendered rather than reported as an
      // opaque "unexpected error".
      logger.error(describeError(error));
    }

    process.exit(1);
  }
}

// Run the CLI
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
