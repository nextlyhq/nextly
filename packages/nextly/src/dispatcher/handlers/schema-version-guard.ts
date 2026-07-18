import { NextlyError } from "../../errors";

// Optimistic-lock guard for visual Schema Builder saves. These are the only
// callers, and every one carries the schemaVersion the editor was loaded at, so
// the version is required: an omitted one is rejected rather than silently
// skipping the check (a crafted request could otherwise bypass it). When the
// submitted version no longer matches the stored one, another session changed
// the schema first and applying this save would overwrite those changes
// (last-write-wins on DDL + metadata), so it is rejected as a conflict for the
// client to reload and retry.
export function assertSchemaVersionMatch(
  expected: number | undefined,
  actual: number,
  slug: string
): void {
  if (expected === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "schemaVersion",
          code: "SCHEMA_VERSION_REQUIRED",
          message: "schemaVersion is required to save schema changes.",
        },
      ],
      logContext: { slug },
    });
  }
  if (expected !== actual) {
    throw NextlyError.conflict({
      reason: "version",
      logContext: { slug, expected, actual },
    });
  }
}
