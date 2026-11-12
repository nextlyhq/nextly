/**
 * The SEO issues card and its Needs attention line: what each declares, and
 * what each answers from the problem list.
 *
 * The list is a stub, so each case can put one list in front of the card's
 * `load` and the line's `count`. That core accepts both declarations at
 * boot, and that each counts what the list's own route answers the same
 * person, is `widget-card.integration.test.ts`'s job, against a real
 * instance.
 */
import { describe, expect, it, vi } from "vitest";

import type { Problem, ProblemKind } from "../problems/contract";
import {
  SEO_ISSUES_WIDGET_ID,
  SEO_PROBLEMS_ATTENTION_ID,
  seoIssuesWidget,
  seoProblemsAttentionItem,
} from "../widget-card";

/** The fields of a declaration this file reads, which the contribution type does not name. */
interface Declared {
  id: string;
  view: unknown;
  size: { default: { w: number; h: number }; min?: { w: number; h: number } };
  access?: unknown;
  skeleton?: unknown;
  empty?: { message?: string };
  preview?: readonly {
    name: string;
    data: { buckets: { value: string; count: number }[] };
  }[];
  load: (input: unknown) => Promise<unknown>;
}

function declared(card: ReturnType<typeof seoIssuesWidget>): Declared {
  if (card === undefined) throw new Error("expected a card");
  return card as unknown as Declared;
}

/** A problem of `kind` on a page of `type`. */
function problem(kind: ProblemKind, type = "posts"): Problem {
  return {
    kind,
    subject: { type, id: "1", label: "Harbour" },
    what: "",
    action: "",
    fix: { place: "page", tab: "seo" },
  };
}

/** A scope that computes each key once, as core's does for one answer. */
function scope() {
  const kept = new Map<string, Promise<unknown>>();
  return {
    getOrCompute: <T>(key: string, compute: () => Promise<T>): Promise<T> => {
      if (!kept.has(key)) kept.set(key, compute());
      return kept.get(key) as Promise<T>;
    },
  };
}

/** What a card or line is handed, for one person. */
const input = (shared = scope()) => ({
  user: { id: "u1" },
  services: {},
  scope: shared,
});

/** The card and line over the list `problems`, and the stub that answers it. */
function over(problems: Problem[], collections = ["posts", "pages"]) {
  const problemsFor = vi.fn(async () => problems);
  return {
    card: seoIssuesWidget({ collections, problemsFor }),
    item: seoProblemsAttentionItem({ collections, problemsFor }),
    problemsFor,
  };
}

describe("the SEO issues card", () => {
  it("is declared as seo/issues, drawn by core's bars view", () => {
    const card = declared(over([]).card);
    expect(card.id).toBe(SEO_ISSUES_WIDGET_ID);
    expect(SEO_ISSUES_WIDGET_ID).toBe("seo/issues");
    expect(card.view).toBe("bars");
    expect(card.skeleton).toBe("bars");
  });

  it("is offered only to a person who may read every collection SEO is added to", () => {
    expect(declared(over([]).card).access).toEqual({
      collections: ["posts", "pages"],
    });
  });

  it("states its size in grid units, at least three rows tall", () => {
    const card = declared(over([]).card);
    expect(card.size.default).toEqual({ w: 4, h: 3 });
    expect(card.size.min?.h).toBe(3);
  });

  it("answers a bar per kind the list holds, named as the list names it, in the list's order", async () => {
    const { card } = over([
      problem("longTitle"),
      problem("noTitle"),
      problem("longTitle", "pages"),
      problem("imageAlt"),
    ]);
    expect(await declared(card).load(input())).toEqual({
      buckets: [
        { value: "Page with no title", count: 1 },
        { value: "Title longer than Google shows", count: 2 },
        { value: "Images with no alt text", count: 1 },
      ],
    });
  });

  it("answers no bars for a list with nothing to fix, so the frame draws its empty state", async () => {
    const card = declared(over([]).card);
    expect(await card.load(input())).toEqual({ buckets: [] });
    expect(card.empty?.message).toBe(
      "The SEO problem list has nothing to fix."
    );
  });

  it("asks for the list of the person it is handed", async () => {
    const { card, problemsFor } = over([]);
    await declared(card).load(input());
    expect(problemsFor).toHaveBeenCalledWith({
      user: { id: "u1" },
      services: {},
    });
  });

  it("is withheld when no collection carries SEO", () => {
    expect(over([], []).card).toBeUndefined();
  });

  it("previews bars drawn the way its load draws them", () => {
    const [sample] = declared(over([]).card).preview ?? [];
    expect(sample?.data.buckets.map(bucket => bucket.value)).toEqual([
      "Page with no description",
      "Title longer than Google shows",
      "Share image missing or the wrong size",
      "Images with no alt text",
    ]);
  });
});

describe("the SEO Needs attention line", () => {
  it("counts every problem the list shows the person, linked to the list", async () => {
    const { item } = over([
      problem("longTitle"),
      problem("noTitle", "pages"),
      { ...problem("productionAddress"), subject: { label: "Whole site" } },
    ]);
    expect(item?.id).toBe(SEO_PROBLEMS_ATTENTION_ID);
    expect(item?.link).toBe("plugins/nextlyhq-plugin-seo/problems");
    expect(item?.collections).toEqual(["posts", "pages"]);
    expect(await item?.count(input() as never)).toBe(3);
  });

  it("reads the list once with the card in one answer", async () => {
    const { card, item, problemsFor } = over([problem("noTitle")]);
    const shared = scope();
    await declared(card).load(input(shared));
    await item?.count(input(shared) as never);
    expect(problemsFor).toHaveBeenCalledTimes(1);
  });

  it("is withheld where the card is", () => {
    expect(over([], []).item).toBeUndefined();
  });
});
