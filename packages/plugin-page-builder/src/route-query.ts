/**
 * A plugin route's query, read and parsed at the boundary.
 *
 * One reading for every route that takes a query, so each refuses what it
 * cannot take the same way: as a validation error that names the parameter and
 * never echoes its value, since what the caller sent goes nowhere but the read
 * it was checked for.
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
 * The parameters `names` of `url`, parsed by `schema`, or a validation error
 * saying `route` does not accept them.
 *
 * Only the parameters the route reads, and each once: a repeated parameter
 * takes its first value, as `URLSearchParams.get` does everywhere.
 */
export function parseRouteQuery<S extends z.ZodType>(
  url: string | URL,
  names: readonly string[],
  schema: S,
  route: string
): z.output<S> {
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
        message: `This parameter is not one the ${route} accepts.`,
      })),
    });
  }
  return parsed.data;
}
