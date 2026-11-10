/**
 * The one rule for an interface language tag: `en`, `fr`, `pt-BR`, `zh-Hant`.
 *
 * Held by the languages a plugin declares translations for and by each user's
 * stored interface language, so a language a user can choose and a language a
 * catalog can be keyed by are one question. The admin matches a catalog to a
 * language by exact spelling, and browsers report the canonical one, so a tag
 * not spelled canonically (`pt-br`) is refused, naming the spelling to use,
 * rather than rewritten: two spellings of one language are never quietly
 * merged.
 *
 * @module shared/lib/language-tag
 */

/** A language, then subtags of two to eight letters or digits. */
const LANGUAGE_SHAPE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** The longest tag kept, which every dialect's column holds whole. */
const LANGUAGE_TAG_MAX_LENGTH = 35;

/** What is wrong with a language tag, when something is. */
export type LanguageTagProblem =
  | { kind: "malformed" }
  | { kind: "not-canonical"; expected: string };

/** A tag's canonical spelling, or `undefined` when it is not a tag at all. */
function canonicalSpelling(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/**
 * What is wrong with `tag` as an interface language, or `null` when nothing
 * is: malformed (not a tag, or longer than {@link LANGUAGE_TAG_MAX_LENGTH}),
 * or not spelled canonically, with the spelling it should use.
 */
export function languageTagProblem(tag: string): LanguageTagProblem | null {
  const canonical = canonicalSpelling(tag);
  if (
    tag.length > LANGUAGE_TAG_MAX_LENGTH ||
    !LANGUAGE_SHAPE.test(tag) ||
    canonical === undefined
  ) {
    return { kind: "malformed" };
  }
  return canonical === tag
    ? null
    : { kind: "not-canonical", expected: canonical };
}
