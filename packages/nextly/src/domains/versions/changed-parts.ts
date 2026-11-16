/**
 * The parts of a document a version changed.
 *
 * Under per-language storage a document has a shared part (its shared fields
 * and its own status) and one part per language. A version records which of
 * them it wrote or moved, so what is kept of a document's history can be
 * judged part by part: on a publish, the parts the publish put live; on a held
 * save, the parts the save wrote. A document kept as one part (no languages)
 * changes its shared part only.
 *
 * Stored on the version row as `changed_locales` and `shared_changed`. Both
 * are NULL on a row recorded before they existed, which reads as unknown.
 *
 * @module domains/versions/changed-parts
 */

/** The languages a version changed, and whether it changed the shared part. */
export interface ChangedParts {
  readonly locales: readonly string[];
  readonly shared: boolean;
}

/** The shared part alone: a document kept as one part, or a shared draft. */
export const SHARED_PART_ALONE: ChangedParts = { locales: [], shared: true };

/**
 * No part: a version that records content as it already stood, such as the
 * snapshot a restore takes of what it is about to replace.
 */
export const NO_PART: ChangedParts = { locales: [], shared: false };

/**
 * The parts a create writes: the document's shared row, which it begins, and
 * the language its translatable values went into, where they went into one.
 */
export function partsCreated(locale: string | null | undefined): ChangedParts {
  return { locales: locale ? [locale] : [], shared: true };
}

/** Every part any of `parts` names: what several changes made together change. */
export function partsTogether(parts: readonly ChangedParts[]): ChangedParts {
  return {
    locales: [...new Set(parts.flatMap(part => part.locales))],
    shared: parts.some(part => part.shared),
  };
}

/**
 * The part a rewrite of one field in place changes: the language it is
 * translated in, or the shared part for a field every language shares.
 */
export function partOfRewrittenField(
  translatedIn: string | null
): ChangedParts {
  return translatedIn === null
    ? SHARED_PART_ALONE
    : { locales: [translatedIn], shared: false };
}
