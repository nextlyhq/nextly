/**
 * Whether an entity autosaves recovery points, read from its schema payload.
 *
 * Mirrors `historyEnabledFrom`, and answers a deliberately narrow question:
 * has the owner turned autosave OFF. The resolved versioning config carries
 * `drafts.autosave.enabled`, so an explicit `false` is a stated preference and
 * writing recovery points anyway would make the setting inert.
 *
 * A payload carrying no versioning information is NOT read as "off". Absence
 * is not a preference: it means this surface cannot tell, and turning the
 * feature off on no evidence would silently withdraw recovery from documents
 * whose owner never expressed a view. Only a stated `false` disables it.
 *
 * @module components/features/versions/autosave-enabled
 */

export function autosaveDisabledBySchema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  if (!("versions" in schema)) return false;

  const { versions } = schema as {
    versions?: { drafts?: { autosave?: { enabled?: boolean } | null } } | null;
  };

  // Only an explicit `false` counts. `undefined` anywhere along this path is
  // missing information rather than a decision.
  return versions?.drafts?.autosave?.enabled === false;
}
