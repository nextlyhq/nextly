/**
 * The languages a rule is told, named as one key and read as one set, so a
 * question kept for a request and a question asked later are compared the
 * same way wherever they are kept.
 *
 * @module auth/access/rule-language-key
 */

/** The languages an operation involves, and the one judged where it is one. */
export interface RuleLanguageOf {
  readonly locale?: string;
  readonly locales: readonly string[];
}

/**
 * `language` as one key: the language judged and every one involved. Two
 * questions with the same key tell a rule the same language.
 */
export function ruleLanguageKeyOf(language: RuleLanguageOf): string {
  return `${language.locale ?? ""}|${language.locales.join(",")}`;
}

/** Every language `language` involves: the one judged and the rest. */
export function languagesIn(language: RuleLanguageOf): ReadonlySet<string> {
  const all = new Set(language.locales);
  if (language.locale !== undefined) all.add(language.locale);
  return all;
}
