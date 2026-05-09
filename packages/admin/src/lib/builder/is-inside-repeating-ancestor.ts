// Why: PR E3 Q9 contract -- `unique` is disabled when the field being
// edited is a descendant of a repeating container. "Repeating" means
// `repeater` (always plural) OR a `component` with `repeatable: true`.
// Singleton groups and non-repeatable components are NOT repeating --
// their children share the parent's row, so `unique` works correctly.
//
// Brainstorm 2026-05-04 Option B locked this predicate.
import type { BuilderField } from "../../components/features/schema-builder/types";

/**
 * Returns true iff the field identified by `fieldId` has at least one
 * ancestor (in the BuilderField tree rooted at `fields`) that is a
 * repeating container.
 *
 * Repeating container = type "repeater" OR (type "component" AND
 * repeatable === true).
 *
 * Returns false for:
 * - top-level fields,
 * - the repeating container itself (only its descendants are nested),
 * - missing field ids,
 * - groups (singleton),
 * - components without repeatable: true.
 */
export function isInsideRepeatingAncestor(
  fieldId: string,
  fields: readonly BuilderField[]
): boolean {
  const result = walk(fields, fieldId, false);
  return result.found && result.insideRepeating;
}

function isRepeatingContainer(field: BuilderField): boolean {
  if (field.type === "repeater") return true;
  if (field.type === "component" && field.repeatable === true) return true;
  return false;
}

type WalkResult = { found: true; insideRepeating: boolean } | { found: false };

// Why: discriminated result so we can tell "not found, keep searching
// siblings" from "found, here's whether the ancestor was repeating".
// Without this distinction we'd lose the answer when the target lives
// inside a non-repeating subtree but later sibling traversal would
// also return false.
function walk(
  fields: readonly BuilderField[],
  targetId: string,
  ancestorIsRepeating: boolean
): WalkResult {
  for (const f of fields) {
    if (f.id === targetId) {
      return { found: true, insideRepeating: ancestorIsRepeating };
    }
    if (f.fields && f.fields.length > 0) {
      const result = walk(
        f.fields,
        targetId,
        ancestorIsRepeating || isRepeatingContainer(f)
      );
      if (result.found) return result;
    }
  }
  return { found: false };
}
