/**
 * A page's SEO problems, read from its answer: what the SEO tab counts beside
 * its label and marks beside the field each one belongs to.
 *
 * What the answer itself shows (a title or description longer than Google
 * shows, or either one missing from every level), what keeps the page's
 * structured data out, and what keeps its share image from showing well. The checks a site
 * publishes for its whole problem list grow from this one function, so the
 * tab and the list cannot count a page differently.
 *
 * @module tab/problems
 */
import type { SeoAnswer } from "../resolver/order";

/** About as many characters of a title as Google shows. */
export const TITLE_LIMIT = 60;

/** About as many characters of a description as Google shows. */
export const DESCRIPTION_LIMIT = 160;

/** One problem with a page's SEO, and the value it belongs to. */
export interface SeoProblem {
  id:
    | "no-title"
    | "title-too-long"
    | "no-description"
    | "description-too-long"
    | "structured-data"
    | "share-image";
  /** The value it is about, where the tab marks it. */
  value: "title" | "description" | "structuredData" | "image";
  /** What is wrong, in one plain sentence. */
  text: string;
}

/**
 * Every problem the answer shows, the title's first, then what keeps the
 * page's structured data out, where it was read.
 */
export function seoProblems(
  answer: SeoAnswer,
  more: {
    structuredData?: { problems: readonly { message: string }[] } | undefined;
    shareImage?: { problems: readonly { message: string }[] } | undefined;
  } = {}
): SeoProblem[] {
  const problems: SeoProblem[] = [];
  const title = answer.title?.value;
  const description = answer.description?.value;
  if (title === undefined) {
    problems.push({
      id: "no-title",
      value: "title",
      text: "There is no title from any level.",
    });
  } else if (title.length > TITLE_LIMIT) {
    problems.push({
      id: "title-too-long",
      value: "title",
      text: "The title is longer than Google shows.",
    });
  }
  if (description === undefined) {
    problems.push({
      id: "no-description",
      value: "description",
      text: "There is no description from any level.",
    });
  } else if (description.length > DESCRIPTION_LIMIT) {
    problems.push({
      id: "description-too-long",
      value: "description",
      text: "The description is longer than Google shows.",
    });
  }
  for (const problem of more.structuredData?.problems ?? []) {
    problems.push({
      id: "structured-data",
      value: "structuredData",
      text: problem.message,
    });
  }
  for (const problem of more.shareImage?.problems ?? []) {
    problems.push({ id: "share-image", value: "image", text: problem.message });
  }
  return problems;
}

/** The count a tab shows beside its label, as the admin draws it. */
export interface ProblemsBadge {
  count: number;
  label: string;
  tone: "attention";
}

/** How many things there are to fix, in words: "1 thing to fix". */
export function thingsToFix(count: number): string {
  return `${count} ${count === 1 ? "thing" : "things"} to fix`;
}

/** The tab's count for `problems`, or none while there is nothing to fix. */
export function problemsBadge(
  problems: readonly SeoProblem[]
): ProblemsBadge | null {
  if (problems.length === 0) return null;
  return {
    count: problems.length,
    label: thingsToFix(problems.length),
    tone: "attention",
  };
}
