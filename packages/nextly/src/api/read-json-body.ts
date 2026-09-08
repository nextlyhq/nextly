import { NextlyError } from "../errors";

/**
 * Parse `request.json()` and surface a structured validation error on
 * malformed bodies.
 *
 * The `code: "invalid_json"` per-field code is part of the canonical
 * validation contract that admin/SDK consumers branch on.
 *
 * Generic over the parsed body type so callers can specify a narrower shape
 * without re-asserting at the call site (the function performs no runtime
 * validation beyond JSON-parseability).
 *
 * Accepts an optional `extraLogContext` so route-specific identifiers (e.g.
 * a single's slug) can be threaded into the operator log without resorting
 * to a route-local copy of the helper.
 */
export async function readJsonBody<T = unknown>(
  req: Request,
  extraLogContext?: Record<string, unknown>
): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      },
      logContext: { reason: "invalid-json-body", ...extraLogContext },
    });
  }
}

/**
 * Read a JSON body, refusing anything past `maxBytes` WITHOUT buffering it.
 *
 * `req.json()` buffers the whole body before anything can look at it, so a
 * quota checked on the parsed result has already paid for the memory and the
 * parse it exists to prevent — an authenticated caller can send a body far past
 * the advertised limit and be refused only after the cost is sunk.
 *
 * This reads the stream in chunks and stops at the first one that crosses the
 * cap, so the work is bounded by the cap rather than by what the caller sent.
 *
 * `Content-Length` is deliberately NOT trusted as the gate: a chunked request
 * carries none, and a declared length is the sender's claim rather than a
 * measurement. It is consulted only as a cheap early refusal for a caller
 * honest enough to declare an oversized body; the running count is what
 * actually enforces.
 *
 * Refuses with the same `invalid_json` contract shape as {@link readJsonBody},
 * under a distinct `too_large` code so a client can tell "unreadable" from
 * "too big".
 */
export async function readBoundedJsonBody<T = unknown>(
  req: Request,
  maxBytes: number,
  extraLogContext?: Record<string, unknown>
): Promise<T> {
  const tooLarge = (): never => {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [
          {
            path: "",
            code: "too_large",
            message: `Request body must be at most ${maxBytes} bytes.`,
          },
        ],
      },
      logContext: { reason: "body-too-large", maxBytes, ...extraLogContext },
    });
  };

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) tooLarge();

  const body = req.body;
  // No stream to bound — an empty body, or a runtime that does not expose one.
  // Falling back keeps this correct rather than refusing a legal request; the
  // parse below still runs, and the caller's own quotas still apply.
  if (!body) return readJsonBody<T>(req, extraLogContext);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Released before throwing, so an oversized upload stops arriving
        // rather than draining in the background after the refusal.
        await reader.cancel();
        tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(merged)) as T;
  } catch {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      },
      logContext: { reason: "invalid-json-body", ...extraLogContext },
    });
  }
}
