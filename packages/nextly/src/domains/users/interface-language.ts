/**
 * Each person's own interface language: the language they chose for the
 * admin, kept apart from any content language.
 *
 * It is theirs to set, through their own profile (`PATCH /api/me`, or the
 * Direct API's `updateMe`), and nobody else's: an edit of a user by an
 * administrator that names it is refused, naming the field, rather than
 * ignored, so the administrator never reads it as saved. A value is a
 * language tag held to the one rule every interface language follows
 * (`shared/lib/language-tag`), or `null` to follow the browser, then English.
 *
 * @module domains/users/interface-language
 */
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { languageTagProblem } from "../../shared/lib/language-tag";

/** The field's name, as a request and the merged user spell it. */
const INTERFACE_LANGUAGE_FIELD = "interfaceLanguage";

/** A language tag, or `null` to follow the browser, then English. */
const interfaceLanguageSchema = z
  .string()
  .nullable()
  .superRefine((tag, ctx) => {
    if (tag === null) return;
    const problem = languageTagProblem(tag);
    if (problem === null) return;
    ctx.addIssue({
      code: "custom",
      message:
        problem.kind === "not-canonical"
          ? `Spell the language "${problem.expected}", as browsers report it.`
          : 'Use a language tag such as "en" or "pt-BR".',
    });
  });

/**
 * The interface language a person's own profile change carries: the parsed
 * value, or `undefined` when the change does not name it. Refused, naming the
 * field, when it is not a language tag or `null`.
 */
export function parseInterfaceLanguage(
  changes: object
): string | null | undefined {
  if (!Object.hasOwn(changes, INTERFACE_LANGUAGE_FIELD)) return undefined;
  const parsed = interfaceLanguageSchema.safeParse(
    (changes as Record<string, unknown>)[INTERFACE_LANGUAGE_FIELD]
  );
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: parsed.error.issues.map(issue => ({
      path: INTERFACE_LANGUAGE_FIELD,
      code: "INVALID_INTERFACE_LANGUAGE",
      message: issue.message,
    })),
  });
}

/**
 * Refuse an edit of a user, other than their own profile change, that names
 * the interface language: it is the person's to choose, through their own
 * profile.
 */
export function assertNoInterfaceLanguage(
  changes: object,
  logContext: Record<string, unknown>
): void {
  if (!Object.hasOwn(changes, INTERFACE_LANGUAGE_FIELD)) return;
  throw NextlyError.validation({
    errors: [
      {
        path: INTERFACE_LANGUAGE_FIELD,
        code: "SELF_ONLY_FIELD",
        message:
          "A person's interface language is theirs to choose, through their own profile.",
      },
    ],
    logContext,
  });
}
