/**
 * The pages the usage index does not cover: listed from its own records, and
 * read for a variable's reference as the builder writes it, within a time box,
 * refusing a page not read rather than guessing.
 *
 * @module uncovered-pages.test
 */
import { tokenRef } from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("each read held to the time box", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** What `promise` has settled to so far, read without awaiting it. */
  const settledOf = <T>(promise: Promise<T>) => {
    const seen: { value?: T } = {};
    void promise.then(value => {
      seen.value = value;
    });
    return seen;
  };

  /** A read that settles only after `ms` of the (fake) clock. */
  const after = <T>(ms: number, settle: () => T) =>
    new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(settle());
        } catch (error) {
          reject(error);
        }
      }, ms);
    });

  const namer = {
    firstReadable: async (uses: readonly { id: string }[]) =>
      uses[0]?.id === "p2" ? "Pricing" : undefined,
  };

  it("refuses within the box, naming the page, when a page's read never finishes", async () => {
    vi.useFakeTimers();
    const p2 = page("p2");
    const pages = pagesOf([
      [page("p1"), [storedUsing()]],
      [p2, [storedUsing()]],
    ]);
    const forms = pages.forms;
    // A read that stalls, as one behind a slow hook can.
    pages.forms = asked =>
      asked === p2 ? new Promise<never>(() => undefined) : forms(asked);
    const reasons = settledOf(
      uncoveredReasons([{ id: "t-spare", name: "Spare" }], pages, namer)
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reasons.value).toEqual([
      {
        message:
          "Pricing could not be read to check whether it uses the variable, so nothing can be removed until it is. Try again shortly.",
        used: false,
      },
    ]);
    // The box's timer is cleared, not left to fire after the answer.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses within the box when the listing of the pages stalls", async () => {
    vi.useFakeTimers();
    const pages: UncoveredPages = {
      list: async function* () {
        yield page("p1");
        // The next page of the index's records never arrives.
        await new Promise<never>(() => undefined);
      },
      forms: async () => [storedUsing()],
    };
    const reasons = settledOf(
      uncoveredReasons([{ id: "t-spare", name: "Spare" }], pages, namer)
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reasons.value).toEqual([
      {
        message:
          "The pages to check for the variable could not all be listed in time, so nothing can be removed until they are. Try again shortly.",
        used: false,
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers a read that fails after the box is spent as unread, leaving its failure handled", async () => {
    vi.useFakeTimers();
    const p1 = page("p1");
    const pages: UncoveredPages = {
      list: async function* () {
        yield p1;
      },
      forms: () =>
        after(6_000, () => {
          throw new Error("unreadable");
        }),
    };
    const outcome = settledOf(
      variablesOnUncoveredPages({
        identities: ["t-spare"],
        pages,
        deadline: Date.now() + 5_000,
      })
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outcome.value).toEqual({ kind: "unread", page: p1 });
    // The losing read still fails later; an unhandled rejection would fail
    // this run.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still answers clear or used where every read finishes inside the box", async () => {
    vi.useFakeTimers();
    const pages: UncoveredPages = {
      list: async function* () {
        yield await after(1_000, () => page("p1"));
        yield await after(1_000, () => page("p2"));
      },
      forms: asked =>
        after(1_000, () =>
          asked.entityKey === "p2" ? [storedUsing("t-accent")] : [storedUsing()]
        ),
    };
    const used = settledOf(
      uncoveredReasons(
        [
          { id: "t-accent", name: "Accent" },
          { id: "t-spare", name: "Spare" },
        ],
        pages,
        namer
      )
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(used.value).toEqual([
      { id: "t-accent", message: "Accent is used on Pricing.", used: true },
    ]);
    expect(vi.getTimerCount()).toBe(0);

    const clear = settledOf(
      uncoveredReasons([{ id: "t-spare", name: "Spare" }], pages, namer)
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(clear.value).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  /** A lookup of the caller's titles that never answers. */
  const stalledNamer = {
    firstReadable: () => new Promise<string | undefined>(() => undefined),
  };

  it("refuses an unread page within the naming box, counting it, when naming it stalls", async () => {
    vi.useFakeTimers();
    const pages = pagesOf([[page("p2"), "fails"]]);
    const reasons = settledOf(
      uncoveredReasons([{ id: "t-spare", name: "Spare" }], pages, stalledNamer)
    );
    await vi.advanceTimersByTimeAsync(5_000);
    // Still refused, saying why, without the title the lookup never gave.
    expect(reasons.value).toEqual([
      {
        message:
          "1 page could not be read to check whether it uses the variable, so nothing can be removed until it is. Try again shortly.",
        used: false,
      },
    ]);
    // The naming box's timer is cleared once it answers.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses used variables within one naming box, counting their pages, when naming stalls", async () => {
    vi.useFakeTimers();
    const pages = pagesOf([
      [page("p1"), [storedUsing("t-accent")]],
      [page("p2"), [storedUsing("t-brand")]],
    ]);
    const asked: string[] = [];
    const reasons = settledOf(
      uncoveredReasons(
        [
          { id: "t-accent", name: "Accent" },
          { id: "t-brand", name: "Brand" },
        ],
        pages,
        {
          firstReadable: uses => {
            asked.push(uses[0]?.id ?? "");
            return stalledNamer.firstReadable();
          },
        }
      )
    );
    // One box for every page the refusal names, not one per variable.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reasons.value).toEqual([
      { id: "t-accent", message: "Accent is used on 1 page.", used: true },
      { id: "t-brand", message: "Brand is used on 1 page.", used: true },
    ]);
    // The box spent, the second page's title is not asked for at all.
    expect(asked).toEqual(["p1"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still names the page where the lookup answers inside the naming box", async () => {
    vi.useFakeTimers();
    const pages = pagesOf([[page("p2"), [storedUsing("t-accent")]]]);
    const reasons = settledOf(
      uncoveredReasons([{ id: "t-accent", name: "Accent" }], pages, {
        firstReadable: () => after(4_000, () => "Pricing"),
      })
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(reasons.value).toEqual([
      { id: "t-accent", message: "Accent is used on Pricing.", used: true },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names a page left unread by the read box running out, in the naming box after it", async () => {
    vi.useFakeTimers();
    const p2 = page("p2");
    const pages = pagesOf([[p2, [storedUsing()]]]);
    // The read spends the whole read box; the lookup then takes a second.
    pages.forms = () => new Promise<never>(() => undefined);
    const reasons = settledOf(
      uncoveredReasons([{ id: "t-spare", name: "Spare" }], pages, {
        firstReadable: () => after(1_000, () => "Pricing"),
      })
    );
    await vi.advanceTimersByTimeAsync(6_000);
    expect(reasons.value).toEqual([
      {
        message:
          "Pricing could not be read to check whether it uses the variable, so nothing can be removed until it is. Try again shortly.",
        used: false,
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);
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
