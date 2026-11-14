/**
 * The pages the usage index does not cover: listed from its own records, and
 * read for a variable's reference as the builder writes it, within a time box,
 * refusing a page not read rather than guessing.
 *
 * @module uncovered-pages.test
 */
import { tokenRef } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  type UncoveredPage,
  type UncoveredPages,
  uncoveredPagesFrom,
  variablesOnUncoveredPages,
} from "./uncovered-pages";
import { uncoveredReasons } from "./variables-routes";

const page = (entityKey: string, entity = "pages"): UncoveredPage => ({
  scope: "collection",
  entity,
  entityKey,
});

/** A stored page whose one heading's colour names `identity`, or nothing. */
const storedUsing = (identity?: string) => ({
  title: "A page",
  content: {
    nodes: [
      {
        id: "h",
        type: "core/heading",
        ...(identity === undefined
          ? {}
          : { styles: { base: { base: { color: tokenRef(identity) } } } }),
      },
    ],
  },
});

/** Pages listed in order, each with its stored forms, or a read that fails. */
function pagesOf(
  entries: ReadonlyArray<[UncoveredPage, unknown[] | "fails"]>
): UncoveredPages & { read: string[] } {
  const read: string[] = [];
  return {
    read,
    list: async function* () {
      for (const [listed] of entries) yield listed;
    },
    forms: async asked => {
      read.push(asked.entityKey);
      const found = entries.find(([listed]) => listed === asked)?.[1];
      if (found === "fails" || found === undefined) {
        throw new Error("unreadable");
      }
      return found;
    },
  };
}

describe("a variable on the pages the index does not cover", () => {
  it("is clear where no uncovered page uses it, read past the walk's bound", async () => {
    // A page far larger than any walk bound: its text is read, not its blocks.
    const large = {
      ...storedUsing(),
      content: {
        nodes: Array.from({ length: 20_000 }, (_, i) => ({ id: `n${i}` })),
      },
    };
    expect(
      await variablesOnUncoveredPages({
        identities: ["t-spare"],
        pages: pagesOf([[page("p1"), [large]]]),
        deadline: Number.POSITIVE_INFINITY,
      })
    ).toEqual({ kind: "clear" });
  });

  it("finds a reference in any stored form, the draft or a language included", async () => {
    const outcome = await variablesOnUncoveredPages({
      identities: ["t-accent", "t-spare"],
      pages: pagesOf([
        [page("p1"), [storedUsing(), storedUsing("t-accent")]],
        [page("p2"), [storedUsing()]],
      ]),
      deadline: Number.POSITIVE_INFINITY,
    });
    expect(outcome).toEqual({
      kind: "used",
      uses: new Map([["t-accent", [page("p1")]]]),
    });
  });

  it("answers a page that cannot be read as unread, never as clear", async () => {
    const p2 = page("p2");
    expect(
      await variablesOnUncoveredPages({
        identities: ["t-spare"],
        pages: pagesOf([
          [page("p1"), [storedUsing()]],
          [p2, "fails"],
        ]),
        deadline: Number.POSITIVE_INFINITY,
      })
    ).toEqual({ kind: "unread", page: p2 });
  });

  it("stops when its time is spent, naming the first page not read", async () => {
    let clock = 0;
    const pages = pagesOf([
      [page("p1"), [storedUsing()]],
      [page("p2"), [storedUsing()]],
      [page("p3"), [storedUsing()]],
    ]);
    const forms = pages.forms;
    // Each read takes three seconds; the box is five.
    pages.forms = async asked => {
      clock += 3_000;
      return forms(asked);
    };
    expect(
      await variablesOnUncoveredPages({
        identities: ["t-spare"],
        pages,
        deadline: 5_000,
        now: () => clock,
      })
    ).toEqual({ kind: "unread", page: page("p3") });
    expect(pages.read).toEqual(["p1", "p2"]);
  });
});

describe("the removal's reasons from the uncovered pages", () => {
  it("refuses, naming the first page not read, when the time box runs out partway", async () => {
    let clock = 0;
    const pages = pagesOf([
      [page("p1"), [storedUsing()]],
      [page("p2"), [storedUsing()]],
    ]);
    const forms = pages.forms;
    // The first read spends the whole box.
    pages.forms = async asked => {
      clock += 6_000;
      return forms(asked);
    };
    const reasons = await uncoveredReasons(
      [{ id: "t-spare", name: "Spare" }],
      pages,
      {
        firstReadable: async uses =>
          uses[0]?.id === "p2" ? "Pricing" : undefined,
      },
      () => clock
    );
    expect(reasons).toEqual([
      {
        message:
          "Pricing could not be read to check whether it uses the variable, so nothing can be removed until it is. Try again shortly.",
        used: false,
      },
    ]);
  });

  it("refuses a variable used on an uncovered page as in use, with the page named", async () => {
    const reasons = await uncoveredReasons(
      [
        { id: "t-accent", name: "Accent" },
        { id: "t-spare", name: "Spare" },
      ],
      pagesOf([[page("p1"), [storedUsing("t-accent")]]]),
      { firstReadable: async () => "Home" }
    );
    expect(reasons).toEqual([
      { id: "t-accent", message: "Accent is used on Home.", used: true },
    ]);
  });

  it("counts the pages where the caller may open none of them", async () => {
    const reasons = await uncoveredReasons(
      [{ id: "t-accent", name: "Accent" }],
      pagesOf([
        [page("p1"), [storedUsing("t-accent")]],
        [page("p2"), [storedUsing("t-accent")]],
      ]),
      {}
    );
    expect(reasons).toEqual([
      { id: "t-accent", message: "Accent is used on 2 pages.", used: true },
    ]);
  });

  it("gives no reason where no uncovered page uses them", async () => {
    expect(
      await uncoveredReasons(
        [{ id: "t-spare", name: "Spare" }],
        pagesOf([[page("p1"), [storedUsing("t-accent")]]]),
        {}
      )
    ).toEqual([]);
  });
});

describe("the uncovered pages, from the index's own records", () => {
  it("lists its undetermined pages, then each document of a type it cannot address, each once", async () => {
    const rows = vi.fn(async ({ page: at }: { page: number }) =>
      at === 1
        ? {
            items: [
              {
                id: "r1",
                scope: "collection",
                entity: "pages",
                entityKey: "p1",
              },
              // The same page's other field or form: one page.
              {
                id: "r2",
                scope: "collection",
                entity: "pages",
                entityKey: "p1",
              },
            ],
            hasNext: true,
          }
        : {
            items: [
              { id: "r3", scope: "single", entity: "homepage", entityKey: "" },
            ],
            hasNext: false,
          }
    );
    const pages = uncoveredPagesFrom({
      rows,
      markers: { tokenId: { equals: "marker" } },
      unaddressable: async () => [
        { scope: "collection", slug: "landing" },
        { scope: "single", slug: "homepage" },
        { scope: "single", slug: "footer" },
        { scope: "collection", slug: "articles" },
      ],
      idsAfter: async (collection, after) => {
        if (collection === "articles") return { ids: ["a1"], hasNext: false };
        return after === undefined
          ? { ids: ["l1", "l2"], hasNext: true }
          : { ids: ["l3"], hasNext: false };
      },
      forms: async () => [],
    });
    const listed: UncoveredPage[] = [];
    for await (const found of pages.list()) listed.push(found);
    expect(listed).toEqual([
      page("p1"),
      { scope: "single", entity: "homepage", entityKey: "" },
      page("l1", "landing"),
      page("l2", "landing"),
      page("l3", "landing"),
      { scope: "single", entity: "footer", entityKey: "" },
      page("a1", "articles"),
    ]);
    // The markers paged by id, from where the last page ended.
    expect(rows.mock.calls[1]?.[0]).toMatchObject({ page: 2, after: "r2" });
  });
});
