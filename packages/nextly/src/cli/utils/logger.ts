/**
 * CLI Logger Utility
 *
 * Provides colored output for CLI commands with support for
 * verbose, quiet, and normal modes.
 *
 * @module cli/utils/logger
 * @since 1.0.0
 */

import pc from "picocolors";

/**
 * Log level for CLI output
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

/**
 * Logger options for customizing output behavior
 */
export interface LoggerOptions {
  /**
   * Enable verbose output (shows debug messages)
   * @default false
   */
  verbose?: boolean;

  /**
   * Enable quiet mode (only shows errors)
   * @default false
   */
  quiet?: boolean;

  /**
   * Disable colors in output
   * @default false
   */
  noColor?: boolean;
}

/**
 * Logger instance interface
 */
export interface Logger {
  /** Log debug message (only shown in verbose mode) */
  debug: (message: string, ...args: unknown[]) => void;
  /** Log info message */
  info: (message: string, ...args: unknown[]) => void;
  /** Log warning message */
  warn: (message: string, ...args: unknown[]) => void;
  /** Log error message */
  error: (message: string, ...args: unknown[]) => void;
  /** Log success message */
  success: (message: string, ...args: unknown[]) => void;
  /** Log a blank line */
  newline: () => void;
  /** Log a divider line */
  divider: (char?: string) => void;
  /** Log a header with emphasis */
  header: (message: string) => void;
  /** Log a list item */
  item: (message: string, indent?: number) => void;
  /** Log a key-value pair */
  keyValue: (key: string, value: string | number | boolean) => void;
  /** Log a table (simple format) */
  table: (headers: string[], rows: (string | number | boolean)[][]) => void;
  /** Create a spinner (returns stop function) */
  spinner: (message: string) => { stop: (success?: boolean) => void };
  /** Update logger options */
  setOptions: (options: LoggerOptions) => void;
  /** Get current options */
  getOptions: () => LoggerOptions;
}

const symbols = {
  success: pc.green("✓"),
  error: pc.red("✗"),
  warning: pc.yellow("⚠"),
  info: pc.blue("ℹ"),
  debug: pc.gray("⋯"),
  arrow: pc.cyan("→"),
  bullet: pc.gray("•"),
};

/**
 * Create a new logger instance
 *
 * @param options - Logger configuration options
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({ verbose: true });
 * logger.info('Starting process...');
 * logger.success('Done!');
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  let currentOptions: LoggerOptions = { ...options };

  const shouldLog = (level: LogLevel): boolean => {
    if (currentOptions.quiet && level !== "error") {
      return false;
    }
    if (level === "debug" && !currentOptions.verbose) {
      return false;
    }
    return true;
  };

  const format = (message: string): string => {
    if (currentOptions.noColor) {
      return message.replace(/\x1B\[[0-9;]*m/g, "");
    }
    return message;
  };

  const log = (
    level: LogLevel,
    prefix: string,
    message: string,
    ...args: unknown[]
  ): void => {
    if (!shouldLog(level)) return;

    const formattedMessage = format(`${prefix} ${message}`);

    if (level === "error") {
      console.error(formattedMessage, ...args);
    } else {
      console.log(formattedMessage, ...args);
    }
  };

  return {
    debug: (message: string, ...args: unknown[]) => {
      log("debug", symbols.debug, pc.gray(message), ...args);
    },

    info: (message: string, ...args: unknown[]) => {
      log("info", symbols.info, message, ...args);
    },

    warn: (message: string, ...args: unknown[]) => {
      log("warn", symbols.warning, pc.yellow(message), ...args);
    },

    error: (message: string, ...args: unknown[]) => {
      log("error", symbols.error, pc.red(message), ...args);
    },

    success: (message: string, ...args: unknown[]) => {
      log("success", symbols.success, pc.green(message), ...args);
    },

    newline: () => {
      if (!currentOptions.quiet) {
        console.log();
      }
    },

    divider: (char = "─") => {
      if (!currentOptions.quiet) {
        console.log(pc.gray(char.repeat(50)));
      }
    },

    header: (message: string) => {
      if (!currentOptions.quiet) {
        console.log();
        console.log(pc.bold(pc.cyan(message)));
        console.log(pc.gray("─".repeat(message.length)));
      }
    },

    item: (message: string, indent = 0) => {
      if (!currentOptions.quiet) {
        const padding = "  ".repeat(indent);
        console.log(`${padding}${symbols.bullet} ${message}`);
      }
    },

    keyValue: (key: string, value: string | number | boolean) => {
      if (!currentOptions.quiet) {
        const valueStr =
          typeof value === "boolean"
            ? value
              ? pc.green("true")
              : pc.red("false")
            : String(value);
        console.log(`  ${pc.gray(key + ":")} ${valueStr}`);
      }
    },

    table: (headers: string[], rows: (string | number | boolean)[][]) => {
      if (currentOptions.quiet) return;

      const widths = headers.map((h, i) => {
        const maxRowWidth = Math.max(
          ...rows.map(r => String(r[i] ?? "").length)
        );
        return Math.max(h.length, maxRowWidth);
      });

      const headerLine = headers
        .map((h, i) => pc.bold(h.padEnd(widths[i])))
        .join("  ");
      console.log(`  ${headerLine}`);

      const separator = widths.map(w => "─".repeat(w)).join("──");
      console.log(`  ${pc.gray(separator)}`);

      for (const row of rows) {
        const rowLine = row
          .map((cell, i) => String(cell ?? "").padEnd(widths[i]))
          .join("  ");
        console.log(`  ${rowLine}`);
      }
    },

    spinner: (message: string) => {
      if (currentOptions.quiet) {
        return { stop: () => {} };
      }

      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let frameIndex = 0;
      let stopped = false;

      const interval = setInterval(() => {
        if (stopped) return;
        process.stdout.write(`\r${pc.cyan(frames[frameIndex])} ${message}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 80);

      return {
        stop: (success = true) => {
          stopped = true;
          clearInterval(interval);
          const icon = success ? symbols.success : symbols.error;
          const color = success ? pc.green : pc.red;
          process.stdout.write(`\r${icon} ${color(message)}\n`);
        },
      };
    },

    setOptions: (newOptions: LoggerOptions) => {
      currentOptions = { ...currentOptions, ...newOptions };
    },

    getOptions: () => ({ ...currentOptions }),
  };
}

/**
 * Default logger instance with default options
 */
export const logger = createLogger();

/**
 * Format a duration in milliseconds to a human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(1500) // "1.5s"
 * formatDuration(100) // "100ms"
 * formatDuration(65000) // "1m 5s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a file size in bytes to a human-readable string
 *
 * @param bytes - Size in bytes
 * @returns Formatted size string
 *
 * @example
 * ```typescript
 * formatBytes(1024) // "1.00 KB"
 * formatBytes(1048576) // "1.00 MB"
 * ```
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format a count with proper pluralization
 *
 * @param count - The count
 * @param singular - Singular form of the word
 * @param plural - Plural form of the word (defaults to singular + 's')
 * @returns Formatted string
 *
 * @example
 * ```typescript
 * formatCount(1, 'file') // "1 file"
 * formatCount(5, 'file') // "5 files"
 * formatCount(0, 'migration') // "0 migrations"
 * ```
 */
export function formatCount(
  count: number,
  singular: string,
  plural?: string
): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}
