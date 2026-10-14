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
