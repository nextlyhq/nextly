/**
 * How the editor's read routes take their query string: the parameter shapes
 * they share, and the one step that parses a query or refuses it.
 *
 * Shared rather than restated per route, so the entries route and the pages
 * search cap a limit, read a search and word a refusal by one rule.
 *
 * @module route-query
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

/**
 * A limit as a URL carries it: a positive whole number, CAPPED at `max` rather
 * than refused above it, since the list a caller can have serves it better
 * than an error. Anything that is not a positive whole number is refused,
 * because it is not a limit at all.
 */
export function cappedLimit(max: number): z.ZodType<number, string> {
  return z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1))
    .transform(value => Math.min(value, max));
}

/**
 * Optional text, trimmed, at most `max` characters; an empty value is none.
 * Refused rather than cut above the bound, because a cut value answers a
 * different question than the one asked.
 */
export function optionalText(
  max: number
): z.ZodType<string | undefined, string | undefined> {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => (value === "" ? undefined : value));
}

/**
 * Read the parameters `names` from `url` and parse them with `schema`, or
 * refuse the request.
 *
 * Only the parameters the route reads, and each once: a repeated parameter
 * takes its first value, as `URLSearchParams.get` does everywhere. A refusal is
 * a validation error naming each parameter with `message`, and never echoing
 * its value: what the caller sent goes nowhere but the read it was checked for.
 */
export function parseRouteQuery<T>(
  url: string | URL,
  names: readonly string[],
  schema: z.ZodType<T>,
  message: string
): T {
  const params = new URL(url).searchParams;
  const raw: Record<string, string> = {};
  for (const name of names) {
    const value = params.get(name);
    if (value !== null) raw[name] = value;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.map(String).join(".") || "query",
        code: "INVALID_QUERY",
        message,
      })),
    });
  }
  return parsed.data;
}
