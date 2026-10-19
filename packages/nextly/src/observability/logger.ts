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

/** Each registered logger's masking wrapper, made once. */
const wrappers = new WeakMap<NextlyLogger, NextlyLogger>();
/** The registered logger behind each wrapper, so a saved wrapper restores it. */
const registeredBehind = new WeakMap<NextlyLogger, NextlyLogger>();

/**
 * Replace the active logger. Pass `undefined` to restore the default JSON-to-console implementation.
 *
 * Typical use lives in `app/instrumentation.ts` via `createNextlyInstrumentation({ logger })`,
 * but this setter is exposed for direct wiring or testing.
 */
export function setNextlyLogger(logger: NextlyLogger | undefined): void {
  // A logger saved from `getNextlyLogger` is a masking wrapper, and is
  // registered as the logger behind it, so saving and restoring puts back
  // what was registered: installing the wrapper itself would give it a
  // wrapper of its own and mask every line twice.
  currentLogger =
    (logger && registeredBehind.get(logger)) ?? logger ?? defaultLogger;
}

/** A payload as it may be written: masked of addresses outside dev and test. */
function writable(payload: object): object {
  return emailMaskingActive() ? maskEmails(payload) : payload;
}

/**
 * The masking wrapper of a registered logger. One per logger, so
 * `getNextlyLogger` hands out the same object for as long as that logger is
 * registered, as it handed out the logger itself before: code holding it, or
 * a test replacing one of its methods, keeps working.
 */
function maskingWrapperOf(logger: NextlyLogger): NextlyLogger {
  const known = wrappers.get(logger);
  if (known) return known;
  const wrapper: NextlyLogger = {
    error: p => logger.error(writable(p)),
    warn: p => logger.warn(writable(p)),
    info: p => logger.info(writable(p)),
    debug: p => logger.debug(writable(p)),
  };
  wrappers.set(logger, wrapper);
  registeredBehind.set(wrapper, logger);
  return wrapper;
}

/**
 * The currently registered logger. Used internally by withErrorHandler / withAction / instrumentation.
 *
 * Every payload is masked of email addresses outside development and test
 * before it reaches the logger, the default or one an app installed: the line
 * ends up in the app's logger either way, so masking only the default writer
 * would leave every app that swapped it unprotected.
 */
export function getNextlyLogger(): NextlyLogger {
  return maskingWrapperOf(currentLogger);
}
