/**
 * The names a file's answers for fields kept per language are known by: the header line that
 * records the language they are decided in, and the reason of the refusal over it.
 *
 * Their own module, importing nothing, because the CLI's error table and the file writers read
 * them without loading what judges a file (`answer-language`).
 *
 * @module domains/i18n/migration/answer-language-names
 */

/**
 * The header line recording the language a file's answers are decided in: the default language of
 * the project that wrote it. Written only by a file that holds one.
 */
export const ANSWERS_HEADER = "-- Answers in:";

/** The line for `language`, or nothing for a file that holds no answer. */
export function answersHeaderLine(language: string | undefined): string {
  return language === undefined
    ? ""
    : `${ANSWERS_HEADER} ${language.replace(/[\r\n\u2028\u2029]+/g, " ")}\n`;
}

/** The `logContext.reason` of a refusal over a file decided in another language. */
export const ANSWER_LANGUAGE_REASON = "migration answers in another language";
