/**
 * Who places a component, as the usage index answers it — and when that answer
 * is only a floor.
 *
 * The property that matters is `complete`: a list called whole when it is not
 * lets a component change pass over a host nobody judged, silently.
 */
import { describe, expect, it } from "vitest";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import { indexHostFinder } from "./component-hosts";
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

/** A Direct API answering `find` from pages of rows, recording what it was asked. */
function api(pages: unknown[][]) {
  const asked: Record<string, unknown>[] = [];
  const nextly = {
    find: async (args: Record<string, unknown>) => {
      asked.push(args);
      const page = Number(args.page ?? 1);
      return {
        items: pages[page - 1] ?? [],
        meta: { hasNext: page < pages.length },
      };
    },
  } as unknown as ClassUsageDirectApi;
  return { nextly, asked };
}

function finder(pages: unknown[][], health: UsageIndexHealth = WHOLE) {
  const { nextly, asked } = api(pages);
  return {
    hostsOf: indexHostFinder({
      nextly: async () => nextly,
      indexCollection: "nx_pb_component_usage",
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

  it("asks for references to this component only, as the system", async () => {
    const { hostsOf, asked } = finder([[row()]]);

    await hostsOf.placing(["hero"]);

    expect(asked[0]).toMatchObject({
      collection: "nx_pb_component_usage",
      where: {
        componentId: { in: ["hero"] },
        kind: { equals: "reference" },
      },
      overrideAccess: true,
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

  it("is a floor when a row names something other than a collection entry", async () => {
    const { hostsOf } = finder([
      [row(), row({ scope: "single", entityKey: "" }), row({ entity: "" })],
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
