/**
 * The context every CLI command runs with, built from the global options.
 *
 * Its own module so that a command can build one without importing the
 * program that registers it, which would make the two import each other.
 */
import { createLogger, type Logger, type LoggerOptions } from "./utils/logger";

/**
 * Global CLI options that apply to all commands
 */
export interface GlobalOptions {
  /**
   * Path to nextly.config.ts file
   */
  config?: string;

  /**
   * Enable verbose output
   */
  verbose?: boolean;

  /**
   * Enable quiet mode (errors only)
   */
  quiet?: boolean;

  /**
   * Working directory
   */
  cwd?: string;

  /**
   * Disable colors
   */
  noColor?: boolean;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  /**
   * Logger instance configured with global options
   */
  logger: Logger;

  /**
   * Global options
   */
  options: GlobalOptions;

  /**
   * Working directory (resolved)
   */
  cwd: string;

  /**
   * Config file path (if specified)
   */
  configPath?: string;
}

/**
 * Build the context a command handler runs with.
 */
export function createContext(options: GlobalOptions): CommandContext {
  const loggerOptions: LoggerOptions = {
    verbose: options.verbose,
    quiet: options.quiet,
    noColor: options.noColor,
  };

  const logger = createLogger(loggerOptions);
  const cwd = options.cwd ?? process.cwd();

  return {
    logger,
    options,
    cwd,
    configPath: options.config,
  };
}
