/**
 * Debug Logging Utilities
 *
 * Provides environment-based debug logging for development and debugging.
 * Logs are only output in development mode or when explicitly enabled.
 */

const IS_DEV = process.env.NODE_ENV === "development";
const DEBUG_PERMISSIONS = process.env.NEXT_PUBLIC_DEBUG_PERMISSIONS === "true";

/**
 * Conditional debug logger
 *
 * Logs messages only in development mode or when DEBUG_PERMISSIONS is enabled.
 * Use this instead of console.log for debugging code that should not run in production.
 */
export const debugLog = (component: string, ...args: unknown[]) => {
  if (IS_DEV || DEBUG_PERMISSIONS) {
    console.log(`[${component}]`, ...args);
  }
};

/**
 * Conditional error logger
 *
 * Always logs errors (even in production) but with component context.
 */
export const debugError = (component: string, ...args: unknown[]) => {
  console.error(`[${component}]`, ...args);
};

/**
 * Conditional warning logger
 *
 * Logs warnings only in development mode or when DEBUG_PERMISSIONS is enabled.
 */
export const debugWarn = (component: string, ...args: unknown[]) => {
  if (IS_DEV || DEBUG_PERMISSIONS) {
    console.warn(`[${component}]`, ...args);
  }
};
