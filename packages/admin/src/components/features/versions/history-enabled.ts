/**
 * Whether an entity records version history, read from its schema payload.
 *
 * The registry always writes a `versions` property and sets it to `null` when
 * the entity is unversioned, so a present-but-null value is a definite "no"
 * rather than missing information. Reading `versions?.enabled` alone cannot
 * tell those apart — both yield `undefined` — which would offer history for
 * every unversioned document.
 *
 * A payload with no `versions` property at all is genuinely unknown, and stays
 * undefined so the caller can decide rather than being told "no" on no evidence.
 *
 * @module components/features/versions/history-enabled
 */

/**
 * @returns `true`/`false` when the schema states it, `undefined` when the
 * payload carries no versioning information.
 */
export function historyEnabledFrom(schema: unknown): boolean | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  if (!("versions" in schema)) return undefined;

  const { versions } = schema as {
    versions?: { enabled?: boolean } | null;
  };

  return Boolean(versions?.enabled);
}
