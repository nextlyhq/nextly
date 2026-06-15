import { NextlyError } from "../errors/nextly-error";

/**
 * Fail-fast boot error for plugin schema merging (D13). Mirrors
 * {@link ./resolution-error}: the specific failure mode is carried in
 * `logContext.reason`; the public message stays generic while the detail
 * (kind/slug/owners) lives in `logContext` for operators.
 */
export function slugCollisionError(
  kind: "collection" | "single" | "component",
  slug: string,
  owners: string[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_SLUG_COLLISION",
    statusCode: 409,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Duplicate ${kind} slug "${slug}" contributed by ${owners.join(" and ")}`,
    logContext: { reason: "slug-collision", kind, slug, owners },
  });
}
