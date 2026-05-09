import type { NextlyError } from "../errors/nextly-error";

/**
 * Observability hook fired by withErrorHandler / withAction / instrumentation
 * after a NextlyError has been classified and logged.
 *
 * Intended for plugging Sentry, Datadog, Better Stack, or OpenTelemetry. The
 * hook receives the NextlyError plus a discriminated context describing the
 * boundary that caught it.
 *
 * Hook implementations run in try/catch so a failing hook never poisons the
 * response or action result.
 */
export type OnErrorHook = (
  err: NextlyError,
  ctx:
    | {
        kind: "route-handler";
        requestId: string;
        route?: string;
        method?: string;
        request: Request;
      }
    | {
        kind: "server-action";
        requestId: string;
      }
    | {
        kind: "framework";
        requestId: string;
      }
) => void | Promise<void>;

let globalOnError: OnErrorHook | undefined;

/**
 * Register a process-wide onError hook. Typically called inside
 * `createNextlyInstrumentation({ onError })` from the developer's
 * `app/instrumentation.ts`. A per-call hook on `withErrorHandler` /
 * `withAction` runs before this one for that boundary.
 */
export function setGlobalOnError(hook: OnErrorHook | undefined): void {
  globalOnError = hook;
}

/** The currently registered global onError hook (or undefined). */
export function getGlobalOnError(): OnErrorHook | undefined {
  return globalOnError;
}
