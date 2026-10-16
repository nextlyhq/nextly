/**
 * Structured logger seam used by nextly.
 *
 * The default implementation writes JSON to console.{error,warn,info,debug}.
 * Works on every serverless and edge runtime without setup. Developers swap
 * it for Pino/Winston/Bunyan/etc. via `setNextlyLogger`.
 *
 * Full observability design (dev-vs-prod formatting, scrub list, audit log,
 */

import { emailMaskingActive, maskEmails } from "./mask-emails";

export interface NextlyLogger {
  error(payload: object): void;
  warn(payload: object): void;
  info(payload: object): void;
  debug(payload: object): void;
}

const defaultLogger: NextlyLogger = {
  error: p =>
    console.error(
      JSON.stringify({ level: "error", ts: new Date().toISOString(), ...p })
    ),
  warn: p =>
    console.warn(
      JSON.stringify({ level: "warn", ts: new Date().toISOString(), ...p })
    ),
  info: p =>
    console.info(
      JSON.stringify({ level: "info", ts: new Date().toISOString(), ...p })
    ),
  debug: p =>
    console.debug(
      JSON.stringify({ level: "debug", ts: new Date().toISOString(), ...p })
    ),
};

let currentLogger: NextlyLogger = defaultLogger;

/**
 * Replace the active logger. Pass `undefined` to restore the default JSON-to-console implementation.
 *
 * Typical use lives in `app/instrumentation.ts` via `createNextlyInstrumentation({ logger })`,
 * but this setter is exposed for direct wiring or testing.
 */
export function setNextlyLogger(logger: NextlyLogger | undefined): void {
  currentLogger = logger ?? defaultLogger;
}

/** A payload as it may be written: masked of addresses outside dev and test. */
function writable(payload: object): object {
  return emailMaskingActive() ? maskEmails(payload) : payload;
}

/**
 * The one object `getNextlyLogger` hands out. It delegates to whichever logger
 * is registered at the moment of each call, after masking, so it stays the
 * same object across `setNextlyLogger` calls, as the registered logger was
 * before: code holding it, or a test replacing one of its methods, keeps
 * working.
 */
const maskingLogger: NextlyLogger = {
  error: p => currentLogger.error(writable(p)),
  warn: p => currentLogger.warn(writable(p)),
  info: p => currentLogger.info(writable(p)),
  debug: p => currentLogger.debug(writable(p)),
};

/**
 * The currently registered logger. Used internally by withErrorHandler / withAction / instrumentation.
 *
 * Every payload is masked of email addresses outside development and test
 * before it reaches the logger, the default or one an app installed: the line
 * ends up in the app's logger either way, so masking only the default writer
 * would leave every app that swapped it unprotected.
 */
export function getNextlyLogger(): NextlyLogger {
  return maskingLogger;
}
