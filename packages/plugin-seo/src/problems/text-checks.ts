/**
 * The one check of a page's title and description: missing from every
 * level, or longer than Google shows. The SEO tab's count beside its label
 * and the problem list's rows for the page both read it, so the two cannot
 * count a page differently. A leaf importing only a type, so the admin's
 * client bundle takes it without server code.
 *
 * @module problems/text-checks
 */
import type { SeoAnswer, Sourced } from "../resolver/order";

/** About as many characters of a title as Google shows. */
export const TITLE_LIMIT = 60;

/** About as many characters of a description as Google shows. */
export const DESCRIPTION_LIMIT = 160;

/** How long `text` reads: in characters, so an emoji counts once. */
export function characters(text: string): number {
  return [...text].length;
}

/** One problem with a page's title or description. */
export interface TextCheck {
  /** Which value it is about. */
  value: "title" | "description";
  /** Missing from every level, or longer than Google shows. */
  problem: "missing" | "long";
  /** The value as the answer has it, where there is one. */
  sourced?: Sourced<string>;
  /** Its length in characters, where it is too long. */
  length?: number;
}

/** The check of one value against its limit. */
function checkOne(
  value: TextCheck["value"],
  sourced: Sourced<string> | undefined,
  limit: number
): TextCheck[] {
  if (sourced === undefined) return [{ value, problem: "missing" }];
  const length = characters(sourced.value);
  return length > limit ? [{ value, problem: "long", sourced, length }] : [];
}

/**
 * The page's title and description problems, the title's first. A page
 * kept out of search (its own setting, or its whole type hidden) has none:
 * how it would show in search is not a problem it has.
 */
export function textChecks(
  answer: Pick<SeoAnswer, "title" | "description" | "robots">
): TextCheck[] {
  if (!answer.robots.value.index) return [];
  return [
    ...checkOne("title", answer.title, TITLE_LIMIT),
    ...checkOne("description", answer.description, DESCRIPTION_LIMIT),
  ];
}
