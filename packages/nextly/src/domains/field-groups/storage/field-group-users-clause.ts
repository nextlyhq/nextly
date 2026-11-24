/**
 * The words that name a field group's users, as one clause: the server's refusal of a move into
 * or out of a field group, and the Schema Builder's refusal of the same gesture, both end with it,
 * so the two can never name them differently. It reads only the list it is given; it imports
 * nothing, so a client component can use it.
 *
 * @module domains/field-groups/storage/field-group-users-clause
 */

/** One user of a field group, as the "used by" list gives it (`fieldGroupUsesAmong`). */
export interface FieldGroupUserNamed {
  readonly entityType: "collection" | "single" | "fieldGroup";
  readonly entitySlug: string;
  /** The field groups between the holder and the field group, holder side first. */
  readonly via?: readonly string[];
}

const NOUNS: Record<FieldGroupUserNamed["entityType"], string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
};

/**
 * Who uses a field group, as one sentence: `It is used by the collection c1, the collection c2,
 * the field group b, the Single s (through b).` Each holder is named once, in the order given
 * (direct uses first), by its noun and slug; one reached through other field groups ends
 * `(through b)`, or `(through c, then b)` for a longer chain. When the reader may not read every
 * user (`complete` false), it ends `, and others you may not read.`; with no user at all, it is
 * empty.
 *
 * @internal The Schema Builder's own refusal reads it, so both say the same; not a public promise.
 */
export function fieldGroupUsersClause(
  uses: readonly FieldGroupUserNamed[],
  complete: boolean
): string {
  const named = new Set<string>();
  const parts: string[] = [];
  for (const use of uses) {
    const key = `${use.entityType}\u0000${use.entitySlug}`;
    if (named.has(key)) continue;
    named.add(key);
    const through =
      use.via !== undefined && use.via.length > 0
        ? ` (through ${use.via.join(", then ")})`
        : "";
    parts.push(`the ${NOUNS[use.entityType]} ${use.entitySlug}${through}`);
  }
  if (complete) {
    return parts.length === 0 ? "" : `It is used by ${parts.join(", ")}.`;
  }
  return parts.length === 0
    ? "It is used by others you may not read."
    : `It is used by ${parts.join(", ")}, and others you may not read.`;
}
