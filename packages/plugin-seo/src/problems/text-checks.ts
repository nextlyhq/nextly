/**
 * The one check of a page's title and description: missing from every
 * level, or wider than Google shows. The SEO tab's count beside its label
 * and the problem list's rows for the page both read it, so the two cannot
 * count a page differently. Imports only a type and the width measure, a
 * leaf itself, so the admin's client bundle takes it without server code.
 *
 * @module problems/text-checks
 */
import type { SeoAnswer, Sourced } from "../resolver/order";

import { textFit, type TextFit } from "./text-width";

/** One problem with a page's title or description. */
export interface TextCheck {
  /** Which value it is about. */
  value: "title" | "description";
  /** Missing from every level, or wider than Google shows. */
  problem: "missing" | "long";
  /** The value as the answer has it, where there is one. */
  sourced?: Sourced<string>;
  /** How it fits Google's results, where it is too wide. */
  fit?: TextFit;
}

/** The check of one value against the width Google shows of it. */
function checkOne(
  value: TextCheck["value"],
  sourced: Sourced<string> | undefined
): TextCheck[] {
  if (sourced === undefined) return [{ value, problem: "missing" }];
  const fit = textFit(value, sourced.value);
  return fit.fits ? [] : [{ value, problem: "long", sourced, fit }];
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
    ...checkOne("title", answer.title),
    ...checkOne("description", answer.description),
  ];
}
