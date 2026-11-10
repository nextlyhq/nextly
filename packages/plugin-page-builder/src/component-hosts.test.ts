/**
 * Who places a component, as the usage index answers it — and when that answer
 * is only a floor.
 *
 * The property that matters is `complete`: a list called whole when it is not
 * lets a component change pass over a host nobody judged, silently.
 */
import { describe, expect, it } from "vitest";

import { indexHostFinder } from "./component-hosts";
import type { UsageRowReader } from "./usage-count";
import type { UsageIndexHealth } from "./usage-index-health";

const WHOLE: UsageIndexHealth = {
  coversExistingDocuments: true,
  anyUndetermined: false,
};

const row = (over: Record<string, unknown> = {}) => ({
  scope: "collection",
  entity: "pages",
  entityKey: "home",
  field: "content",
  locale: "",
  variant: "published",
  kind: "reference",
  componentId: "hero",
  ...over,
});

/** A row reader answering from pages of rows, recording what it was asked. */
function reader(pages: unknown[][]) {
  const asked: Record<string, unknown>[] = [];
  const rows: UsageRowReader = async args => {
    asked.push(args);
    return {
      items: pages[args.page - 1] ?? [],
      hasNext: args.page < pages.length,
    };
  };
  return { rows, asked };
}

function finder(pages: unknown[][], health: UsageIndexHealth = WHOLE) {
  const { rows, asked } = reader(pages);
  return {
    hostsOf: indexHostFinder({
      rows: () => rows,
      health: async () => health,
    }),
    asked,
  };
}

describe("finding a component's hosts in the usage index", () => {
  it("lists each document and field once, however many rows record it", async () => {
    const { hostsOf } = finder([
      [row(), row({ variant: "draft" }), row({ entityKey: "about" })],
    ]);

    expect(await hostsOf.placing(["hero"])).toEqual({
      hosts: [
        { slug: "pages", id: "home", field: "content", localized: false },
        { slug: "pages", id: "about", field: "content", localized: false },
      ],
      complete: true,
    });
  });

  it("asks for references to this component only", async () => {
    const { hostsOf, asked } = finder([[row()]]);

    await hostsOf.placing(["hero"]);

    expect(asked[0]).toMatchObject({
      where: {
        componentId: { in: ["hero"] },
        kind: { equals: "reference" },
      },
    });
  });

  it("reads every page of rows", async () => {
    const { hostsOf } = finder([[row()], [row({ entityKey: "about" })]]);

    expect((await hostsOf.placing(["hero"])).hosts.map(h => h.id)).toEqual([
      "home",
      "about",
    ]);
  });

  it("marks a host localized when any of its rows is in one language", async () => {
    const { hostsOf } = finder([[row(), row({ locale: "fr" }), row()]]);

    expect((await hostsOf.placing(["hero"])).hosts).toEqual([
      { slug: "pages", id: "home", field: "content", localized: true },
    ]);
  });

  it("is a floor when the index cannot vouch for every document", async () => {
    const { hostsOf } = finder([[row()]], {
      coversExistingDocuments: false,
      anyUndetermined: false,
    });

    expect(await hostsOf.whole()).toBe(false);
    // CONTROL: the lookup itself read every row there was.
    expect((await hostsOf.placing(["hero"])).complete).toBe(true);
  });

  it("lists a Single by its slug, apart from an entry of a collection of that name", async () => {
    const { hostsOf } = finder([
      [row(), row({ scope: "single", entity: "pages", entityKey: "" })],
    ]);

    expect(await hostsOf.placing(["hero"])).toEqual({
      hosts: [
        { slug: "pages", id: "home", field: "content", localized: false },
        {
          slug: "pages",
          id: "",
          field: "content",
          localized: false,
          single: true,
        },
      ],
      complete: true,
    });
  });

  it("is a floor when a row names no document it can address", async () => {
    const { hostsOf } = finder([
      [
        row(),
        row({ entity: "" }),
        row({ scope: "single", entity: "home", entityKey: "stray" }),
        row({ scope: "collection", entityKey: "" }),
      ],
    ]);

    const answer = await hostsOf.placing(["hero"]);
    expect(answer.complete).toBe(false);
    expect(answer.hosts.map(h => h.id)).toEqual(["home"]);
  });

  it("is a floor when there are more rows than one lookup reads", async () => {
    const pages = Array.from({ length: 30 }, (_, p) =>
      Array.from({ length: 200 }, (_, i) =>
        row({ entityKey: `p${String(p)}-${String(i)}` })
      )
    );
    const { hostsOf, asked } = finder(pages);

    const answer = await hostsOf.placing(["hero"]);
    expect(answer.complete).toBe(false);
    expect(asked.length).toBe(25);
  });

  it("is whole when the index covers every document", async () => {
    const { hostsOf } = finder([[row()]]);

    expect(await hostsOf.whole()).toBe(true);
  });

  it("asks for a whole frontier in one query, not one per component", async () => {
    const { hostsOf, asked } = finder([
      [
        row({ componentId: "a" }),
        row({ componentId: "b", entityKey: "about" }),
      ],
    ]);

    const answer = await hostsOf.placing(["a", "b"]);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      where: { componentId: { in: ["a", "b"] } },
    });
    expect(answer.hosts.map(h => h.id)).toEqual(["home", "about"]);
  });
});
