/**
 * The SEO tab and the problem list count a page's title and description
 * problems alike: for every answer, the tab's count beside its label and
 * the list's rows for the page name the same problems.
 */
import { describe, expect, it } from "vitest";

import type { SeoAnswer } from "../../resolver/order";
import { seoProblems } from "../../tab/problems";
import { pageProblems, type PageFacts } from "../page-checks";

const LISTED = { value: { index: true, follow: true }, from: "site" } as const;
const HIDDEN = { value: { index: false, follow: true }, from: "page" } as const;

/** A page whose only facts are its answer. */
function facts(answer: SeoAnswer): PageFacts {
  return {
    subject: { type: "posts", id: "7", label: "Harbour walk" },
    answer,
    canonicalIsOwn: true,
    canonicalConfirmed: false,
    shareImage: [],
    structuredData: [],
    images: [],
    brokenLinks: [],
    languageCodes: [],
  };
}

/** The list's problem kind for each of the tab's title and description ids. */
const SAME_AS = {
  "no-title": "noTitle",
  "title-too-long": "longTitle",
  "no-description": "noDescription",
  "description-too-long": "longDescription",
} as const;

/** The title and description problems the tab counts, as the list names them. */
function tabCounts(answer: SeoAnswer): string[] {
  return seoProblems(answer).flatMap(problem =>
    problem.id in SAME_AS ? [SAME_AS[problem.id as keyof typeof SAME_AS]] : []
  );
}

/** The title and description problems the list holds for the page. */
function listCounts(answer: SeoAnswer): string[] {
  const kinds: readonly string[] = Object.values(SAME_AS);
  return pageProblems(facts(answer))
    .map(problem => problem.kind)
    .filter(kind => kinds.includes(kind));
}

const text = (value: string) => ({ value, from: "page" as const });

const ANSWERS: [string, SeoAnswer][] = [
  [
    "nothing wrong",
    { title: text("Harbour"), description: text("A walk."), robots: LISTED },
  ],
  ["no title or description", { robots: LISTED }],
  [
    "a title and a description wider than Google shows",
    {
      title: text("W".repeat(40)),
      description: text("W".repeat(70)),
      robots: LISTED,
    },
  ],
  [
    "a title of narrow letters past 60 characters that still fits",
    {
      title: text("i".repeat(120)),
      description: text("A walk."),
      robots: LISTED,
    },
  ],
  [
    "a title at the width, in emoji, two UTF-16 units each",
    {
      title: text("😀".repeat(30)),
      description: text("A walk."),
      robots: LISTED,
    },
  ],
  [
    "a description past the width, in emoji",
    {
      title: text("Harbour"),
      description: text("😀".repeat(70)),
      robots: LISTED,
    },
  ],
  ["a page hidden from search with no title", { robots: HIDDEN }],
  [
    "a page hidden from search with a long title",
    { title: text("t".repeat(80)), robots: HIDDEN },
  ],
];

describe("the title and description checks the tab and the list share", () => {
  it.each(ANSWERS)("count alike for %s", (_name, answer) => {
    expect(tabCounts(answer)).toEqual(listCounts(answer));
  });

  it("are not satisfied by both finding nothing", () => {
    // A positive control: the answers above include ones each side reports.
    expect(listCounts({ robots: LISTED })).toEqual([
      "noTitle",
      "noDescription",
    ]);
    expect(tabCounts({ title: text("W".repeat(40)), robots: LISTED })).toEqual([
      "longTitle",
      "noDescription",
    ]);
  });
});
