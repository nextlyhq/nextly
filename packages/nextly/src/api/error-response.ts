/**
 * Building the finished error `Response` a caller receives.
 *
 * One owner, because the body is not only `toResponseJSON()`. It also carries
 * the development-only detail, the `Retry-After` a rate limit needs, the
 * problem+json content type and the request id an operator joins on — and a
 * second boundary rebuilding that by hand agrees on the parts it remembered
 * and differs on the rest. That is what happened: plugin routes hand-built the
 * body and so answered without the diagnostics every other route carries.
 *
 * A boundary composes this rather than being handed a finished response to
 * amend. Rewriting a body that is already final means parsing what was just
 * serialized and re-serializing it, which is how a diagnostic aid ends up able
 * to fail the request it describes.
 *
 * @module api/error-response
 */

import type { NextlyError } from "../errors/nextly-error";

/**
 * A value that is safe to put on a response body, or undefined.
 *
 * `logContext` is whatever a thrower attached, so it can hold a cycle, a
 * BigInt, or anything else `JSON.stringify` refuses. Serializing the response
 * happens after this, inside the error path, so a value that throws there
 * would reject the request instead of returning the error the handler built --
 * turning a diagnostic aid into a failure worse than the one it describes.
 *
 * Round-tripped rather than inspected: that is the same operation the response
 * will perform, so it answers the exact question rather than an approximation
 * of it.
 */
function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return "[unserializable]";
  }
}

/**
 * Whether an error response may carry the detail the public shape withholds.
 *
 * Two signals, both required. `NODE_ENV` is not sufficient on its own because
 * this package is published pre-built and app builds keep it external, so the
 * check runs at runtime and a misconfigured production deployment would
 * satisfy it. `NEXTLY_DEV_DIAGNOSTICS` is named for exactly one purpose, so
 * nothing sets it incidentally.
 *
 * Read per call rather than cached, so a test can exercise both sides and so a
 * process cannot latch the permissive answer from however it happened to start.
 */
export function devDiagnosticsEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXTLY_DEV_DIAGNOSTICS === "1"
  );
}

/**
 * The detail an author cannot see from a public error response.
 *
 * Built only for a development response. `logContext` and `cause` are what the
 * public shape deliberately withholds, so this exists to shorten the loop
 * between a failure and its cause while writing code -- not to be a second
 * error surface. A cause is reduced to its message: a serialized stack is
 * large, and the log already has the whole thing against the same request id.
 *
 * Returns undefined when there is nothing to add, so an ordinary development
 * error response is the same shape a production one is.
 */
function buildDevDiagnostics(
  thrown: NextlyError,
  flattened: readonly NextlyError[]
): Record<string, unknown> | undefined {
  const causeMessage = (error: NextlyError): string | undefined =>
    error.cause instanceof Error ? error.cause.message : undefined;

  const detail: Record<string, unknown> = {};
  const context = jsonSafe(thrown.logContext);
  if (context !== undefined) detail.logContext = context;
  const thrownCause = causeMessage(thrown);
  if (thrownCause !== undefined) detail.cause = thrownCause;

  // Errors the envelope flattened before this frame. Without them the response
  // names only the boundary's reconstruction, which is the defect that makes
  // every unexpected failure look alike.
  const earlier = flattened.map(error => ({
    code: error.code,
    ...(jsonSafe(error.logContext) !== undefined
      ? { logContext: jsonSafe(error.logContext) }
      : {}),
    ...(causeMessage(error) !== undefined
      ? { cause: causeMessage(error) }
      : {}),
  }));
  if (earlier.length > 0) detail.flattened = earlier;

  return Object.keys(detail).length > 0 ? detail : undefined;
}

/** What a boundary supplies beyond the error itself. */
export interface ErrorResponseOptions {
  /** The id the caller sees and an operator joins the log on. */
  requestId: string;
  /**
   * Public message for an `INTERNAL_ERROR`, when the boundary was configured
   * with one. Applied at the wire-format step so the error's own identity is
   * unchanged and only what leaves differs.
   */
  internalMessage?: string;
  /**
   * Errors flattened earlier in this request. Passed in rather than read from
   * the request scope here: the scope closes when the handler returns, so the
   * boundary is the only frame that can still see it.
   */
  flattened?: readonly NextlyError[];
}

/**
 * Serialize an error into the response a caller receives.
 *
 * Sets the request id here rather than leaving it to a later wrapper, so a
 * boundary that has no such wrapper is not the one that answers without it.
 */
export function buildErrorResponse(
  error: NextlyError,
  options: ErrorResponseOptions
): Response {
  const responseJson = error.toResponseJSON(options.requestId);
  if (
    error.code === "INTERNAL_ERROR" &&
    options.internalMessage !== undefined
  ) {
    responseJson.message = options.internalMessage;
  }

  // Development-only diagnostics, gated on TWO independent signals.
  //
  // `nextly` ships as a pre-built package and app builds keep it external, so
  // nothing rewrites this file: `NODE_ENV` is read at runtime, and a production
  // deployment started with the wrong value would otherwise disclose the detail
  // the public shape exists to withhold. So the gate also requires an
  // explicitly named opt-in that nothing sets by accident, and neither signal
  // alone is enough.
  //
  // Same shape as the dev auto-login, which is the more dangerous feature of
  // the two and is already guarded this way: an explicit opt-in plus a
  // production block, rather than an environment name on its own.
  if (devDiagnosticsEnabled()) {
    const devDetail = buildDevDiagnostics(error, options.flattened ?? []);
    if (devDetail) {
      (responseJson as Record<string, unknown>)._devDiagnostics = devDetail;
    }
  }

  const responseHeaders: Record<string, string> = {
    "content-type": "application/problem+json",
    "x-request-id": options.requestId,
  };
  // Type-narrow on shape rather than cast -- defends against future
  // PublicData variants.
  if (error.code === "RATE_LIMITED") {
    const data = error.publicData;
    if (
      data &&
      "retryAfterSeconds" in data &&
      typeof data.retryAfterSeconds === "number"
    ) {
      responseHeaders["retry-after"] = String(data.retryAfterSeconds);
    }
  }

  return new Response(JSON.stringify({ error: responseJson }), {
    status: error.statusCode,
    headers: responseHeaders,
  });
}
