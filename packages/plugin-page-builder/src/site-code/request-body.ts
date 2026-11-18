/**
 * A site code route's request body, parsed at the boundary: the one reading
 * the site code and site CSS saves share, so both refuse a malformed body
 * with the same validation answer.
 *
 * @module site-code/request-body
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { z } from "nextly/zod";

/** Parse a request's body with `schema`, refusing one it does not accept. */
export async function requestBodyOf<S extends z.ZodType>(
  req: Request,
  schema: S
): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join(".") || "body",
        code: "INVALID_VALUE",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
