/**
 * Structured logger seam used by @revnixhq/nextly.
 *
 * The default implementation writes JSON to console.{error,warn,info,debug}.
 * Works on every serverless and edge runtime without setup. Developers swap
 * it for Pino/Winston/Bunyan/etc. via `setNextlyLogger`.
 *
 * Full observability design (dev-vs-prod formatting, scrub list, audit log,
 * slow-operation hooks, OTEL conventions) lives in plan 22.
 */
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

/** The currently registered logger. Used internally by withErrorHandler / withAction / instrumentation. */
export function getNextlyLogger(): NextlyLogger {
  return currentLogger;
}
