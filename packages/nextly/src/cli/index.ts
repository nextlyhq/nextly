/**
 * Nextly CLI Module
 *
 * This module exports the CLI program and utilities for programmatic usage.
 *
 * @remarks
 * While the CLI is typically run via `npx nextly`, you can also use
 * these exports programmatically in your own scripts.
 *
 * @example
 * ```typescript
 * import { createProgram, createContext } from '@revnixhq/nextly/cli';
 *
 * // Run a specific command programmatically
 * const program = createProgram();
 * await program.parseAsync(['node', 'nextly', 'generate:types']);
 * ```
 *
 * @module cli
 * @since 1.0.0
 */

// Program exports
export {
  createProgram,
  createContext,
  CLI_VERSION,
  type GlobalOptions,
  type CommandContext,
} from "./program.js";

// Command exports
// Task 11 rename: runDev -> runDbSync, DevCommandOptions -> DbSyncCommandOptions.
export { runDbSync, type DbSyncCommandOptions } from "./commands/db-sync.js";

// Re-export utilities
export * from "./utils/index.js";
