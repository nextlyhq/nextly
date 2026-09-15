/**
 * The category the project moved away from, as two patterns and one classifier, with no imports.
 *
 * Its own module, and importing nothing, because a job that installs no packages loads it. The
 * scheduled repository-metadata check runs straight after checkout — the GitHub About line and the
 * topic list are repository settings rather than files, so only a scheduled run can observe them —
 * and any module in that check's import closure that reaches for an npm package fails the job
 * before it examines anything.
 *
 * Kept apart from the docs-claims check, which compiles MDX: the metadata check needs these three
 * definitions and nothing else, and must not load a compiler to get them. There is still exactly
 * one definition — the docs-claims check imports and re-exports it rather than restating it.
 *
 * `no-install-jobs.test.mjs` holds the property for every script a workflow starts without
 * installing: its whole import graph must be Node builtins.
 */

/**
 * The category the project moved away from.
 *
 * A hyphen or whitespace between the words, because the repository has spelled
 * it both ways and a reader sees no difference, and an optional plural, because
 * "one of several app frameworks" is the same claim about the same category.
 */
export const RETIRED_CATEGORY = /\bapp(?:-|\s+)frameworks?\b/i;

/**
 * The same category, as a whole tag rather than a phrase in prose.
 *
 * npm keywords and GitHub topics are both single tokens on a surface people search, and both
 * were left carrying `framework` after the prose was cleared. The word is the one the whole
 * repositioning turned on: it could mean an application framework, a UI framework or a backend
 * framework, which made it the least informative word available.
 *
 * `RETIRED_CATEGORY` cannot serve here — it requires the `app` prefix, so a bare `framework`
 * tag would pass. Anchored rather than substring-matched: `page-builder` and `nextly-plugin`
 * are tags this must never touch.
 */
export const RETIRED_CATEGORY_TAG = /^(?:app-)?frameworks?$/i;

/**
 * The single answer to "does this tag name the retired category", for every tag surface.
 *
 * A tag can carry the category two ways, and one pattern cannot see both: as the whole tag
 * (`framework`), or with the phrase embedded in a longer one (`nextjs-app-framework`). Two
 * checks used to answer this for npm keywords — the prose check matched the phrase, the
 * keyword check matched the whole tag — so a keyword like `app-framework` was reported twice
 * under two names, and their patterns were free to drift apart. This is now the only answer,
 * shared by npm keywords and GitHub topics.
 */
export function namesRetiredCategory(tag) {
  return typeof tag === "string" && (RETIRED_CATEGORY_TAG.test(tag) || RETIRED_CATEGORY.test(tag));
}
