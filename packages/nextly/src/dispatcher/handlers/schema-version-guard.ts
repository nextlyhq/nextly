import { NextlyError } from "../../errors";

// Optimistic-lock guard for visual Schema Builder saves. A UI save carries the
// schemaVersion the editor was loaded at. If that no longer matches the stored
// version, another session changed the schema first and applying this save
// would silently overwrite those changes (last-write-wins on DDL + metadata).
// Throw a version conflict so the client reloads and retries. An `undefined`
// expected version means the caller is code-first HMR, which is the source of
// truth for code edits and deliberately skips the check.
export function assertSchemaVersionMatch(
  expected: number | undefined,
  actual: number,
  slug: string
): void {
  if (expected !== undefined && expected !== actual) {
    throw NextlyError.conflict({
      reason: "version",
      logContext: { slug, expected, actual },
    });
  }
}
