import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { z } from "zod";

/**
 * Parse what a caller handed commerce (a request body, a server function's
 * arguments, a source's options), refusing it as core's validation error with
 * a field error per problem, so a storefront can show each beside its field.
 * The messages describe the expected shape only; nothing the caller sent is
 * echoed in them.
 */
export function parseRequest<T>(
  schema: z.ZodType<T>,
  input: unknown,
  logContext?: Record<string, unknown>
): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: parsed.error.issues.map(issue => ({
      path: issuePath(issue.path),
      code: "INVALID",
      message: asSentence(issue.message),
    })),
    ...(logContext === undefined ? {} : { logContext }),
  });
}

/** A zod issue's path in the `items[2].quantity` spelling field errors use. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path
    .map((key, index) =>
      typeof key === "number"
        ? `[${key}]`
        : `${index === 0 ? "" : "."}${String(key)}`
    )
    .join("");
}

// Zod's messages start lower-case and end without a stop; a field error reads
// as a sentence.
function asSentence(message: string): string {
  const sentence = message.charAt(0).toUpperCase() + message.slice(1);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

/** The largest request body commerce reads: far more than a cart line needs. */
export const MAX_REQUEST_BYTES: number = 16 * 1024;

/**
 * A request's JSON body, read in chunks and refused at the first chunk past
 * `maxBytes`, so a body far larger than any commerce request is never held in
 * memory whole. `Content-Length` refuses an honest oversized body at once;
 * the running count is what enforces, since a chunked body declares none.
 * A body that is not JSON answers `undefined`, which the request's own schema
 * then refuses.
 *
 * @throws `VALIDATION_ERROR` with a `too_large` field error
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_REQUEST_BYTES
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLarge(maxBytes);
  }
  const stream = request.body;
  if (!stream) return undefined;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function tooLarge(maxBytes: number): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "",
        code: "too_large",
        message: `The request body is larger than ${String(maxBytes)} bytes.`,
      },
    ],
    logContext: { reason: "body-too-large", maxBytes },
  });
}
