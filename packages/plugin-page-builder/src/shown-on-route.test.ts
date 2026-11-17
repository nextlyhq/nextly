/**
 * Where the builder shows a Single's values, as one reader is answered: one
 * read of the index, the places they may open named and capped at ten, the
 * rest counted as a number, and nothing at all for a Single they may not
 * read. Against a real database by
 * `__tests__/shown-on.integration.test.ts`.
 */
import type { BlockRegistryReader } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { ReadableDocument } from "./bindings-report/readable";
import type { StoredUse } from "./bindings-report/uses-store";
import { SHOWN_ON_ROUTE_PATH, shownOnPath } from "./shown-on-contract";
import { readShownOn, shownOnRoute, type ShownOnDeps } from "./shown-on-route";

/** A use of the Homepage Single by block `nodeId` of page `id`. */
const use = (
  id: string,
  nodeId: string,
  extra: Partial<StoredUse> = {}
): StoredUse => ({
  documentKey: `collection:pages:${id}`,
  kind: "collection",
  slug: "pages",
  documentId: id,
  place: "pages",
  version: "published",
  blocksField: "content",
  nodeId,
  blockType: "core/heading",
  prop: "text",
  sourceKey: "homepage",
  path: "headline",
  ...extra,
});

/** The site's blocks, as far as a label is read: one heading. */
const blocks = {
  get: (name: string) =>
    name === "core/heading" ? { editor: { label: "Heading" } } : undefined,
} as unknown as BlockRegistryReader;

interface Fixture {
  readonly uses: readonly StoredUse[];
  /** Page ids the reader may read; every one when absent. */
  readonly readable?: readonly string[];
  /** The fields the reader may read of every page; `content` when absent. */
  readonly fields?: readonly string[];
  readonly filled?: boolean;
  readonly singleReadable?: boolean;
  readonly installed?: boolean;
  readonly defaultLocale?: string;
}

function depsFor(fixture: Fixture) {
  const ofSingle = vi.fn(async () => [...fixture.uses]);
  const deps: ShownOnDeps = {
    uses: () =>
      fixture.installed === false
        ? null
        : { ofSingle, filled: async () => fixture.filled ?? true },
    readable: async (_ctx, entries) => {
      const found = new Map<string, ReadableDocument>();
      for (const entry of entries) {
        const id = entry.documentId ?? "";
        if (fixture.readable !== undefined && !fixture.readable.includes(id)) {
          continue;
        }
        found.set(entry.documentKey, {
          title: entry.kind === "single" ? entry.slug : `Page ${id}`,
          fields: new Set(fixture.fields ?? ["content"]),
          collectionLabel: "Pages",
        });
      }
      return found;
    },
    mayReadSingle: async () => fixture.singleReadable !== false,
    singleLabels: async (_ctx, slugs) =>
      new Map([...slugs].map(slug => [slug, `The ${slug}`])),
    defaultLocale: () => fixture.defaultLocale,
    blocks,
  };
  return { deps, ofSingle };
}

const ctx = {} as PluginRouteContext;

describe("readShownOn", () => {
  it("names each place by its document and its block, as Layers names it", async () => {
    const { deps } = depsFor({
      uses: [
        use("home", "hero", { blockName: "Hero section" }),
        use("about", "intro"),
        use("about", "", { blockType: "", prop: "seo.title" }),
      ],
    });
    const answer = await readShownOn("homepage", false, ctx, deps);
    expect(answer.places.map(place => [place.title, place.block])).toEqual([
      ["Page about", "Heading"],
      ["Page about", "Page metadata"],
      ["Page home", "Hero section"],
    ]);
    expect(answer).toMatchObject({ checking: false, more: 0, hidden: 0 });
    expect(answer.places[2]).toMatchObject({
      kind: "collection",
      slug: "pages",
      documentId: "home",
      nodeId: "hero",
      blocksField: "content",
    });
  });

  it("asks the index once, and lists a block bound in the draft and the published value once", async () => {
    const { deps, ofSingle } = depsFor({
      uses: [
        use("home", "hero"),
        use("home", "hero", { version: "draft", prop: "subtitle" }),
      ],
    });
    const answer = await readShownOn("homepage", false, ctx, deps);
    expect(answer.places).toHaveLength(1);
    expect(ofSingle).toHaveBeenCalledTimes(1);
    expect(ofSingle).toHaveBeenCalledWith("homepage", expect.any(Number));
  });

  it("lists only the places the reader may open, and counts the others as a number", async () => {
    const { deps } = depsFor({
      uses: [use("home", "hero"), use("secret", "a"), use("secret", "b")],
      readable: ["home"],
    });
    const answer = await readShownOn("homepage", false, ctx, deps);
    expect(answer.places.map(place => place.documentId)).toEqual(["home"]);
    expect(answer.hidden).toBe(2);
    // Nothing of the hidden page reaches the answer but the number.
    expect(JSON.stringify(answer)).not.toContain("secret");
  });

  it("counts a place in a field the reader may not read as one they can't open", async () => {
    const { deps } = depsFor({
      uses: [use("home", "hero")],
      fields: ["title"],
    });
    const answer = await readShownOn("homepage", false, ctx, deps);
    expect(answer.places).toEqual([]);
    expect(answer.hidden).toBe(1);
  });

  it("lists the first ten, says how many more, and lists them all when asked", async () => {
    const uses = Array.from({ length: 12 }, (_, index) =>
      use(`p${String(index).padStart(2, "0")}`, "hero")
    );
    const { deps } = depsFor({ uses });
    const first = await readShownOn("homepage", false, ctx, deps);
    expect(first.places).toHaveLength(10);
    expect(first.more).toBe(2);
    const all = await readShownOn("homepage", true, ctx, deps);
    expect(all.places).toHaveLength(12);
    expect(all.more).toBe(0);
  });

  it("says it is still checking until the index has been filled once", async () => {
    expect(
      await readShownOn(
        "homepage",
        false,
        ctx,
        depsFor({ uses: [], filled: false }).deps
      )
    ).toEqual({ checking: true, places: [], more: 0, hidden: 0 });
    expect(
      await readShownOn("homepage", false, ctx, depsFor({ uses: [] }).deps)
    ).toEqual({ checking: false, places: [], more: 0, hidden: 0 });
    // Before the plugin's tables are ready: still checking, and no read.
    expect(
      await readShownOn(
        "homepage",
        false,
        ctx,
        depsFor({ uses: [], installed: false }).deps
      )
    ).toEqual({ checking: true, places: [], more: 0, hidden: 0 });
  });

  it("refuses a reader who may not read the Single, before reading the index", async () => {
    const { deps, ofSingle } = depsFor({
      uses: [use("home", "hero")],
      singleReadable: false,
    });
    const refused = await readShownOn("homepage", false, ctx, deps).catch(
      (error: unknown) => error
    );
    expect(NextlyError.isForbidden(refused)).toBe(true);
    expect(ofSingle).not.toHaveBeenCalled();
  });

  it("names a Single holding blocks by its label, and marks a place only in another language", async () => {
    const { deps } = depsFor({
      defaultLocale: "en",
      uses: [
        use("", "hero", {
          documentKey: "single:landing",
          kind: "single",
          slug: "landing",
          place: "singles",
          locale: "fr",
        }),
      ],
    });
    const [place] = (await readShownOn("homepage", false, ctx, deps)).places;
    expect(place).toMatchObject({
      title: "The landing",
      inAnotherLanguage: true,
    });
  });
});

describe("shownOnRoute", () => {
  it("answers at the Single's address, judged by its handler, never stored", async () => {
    const { deps } = depsFor({ uses: [use("home", "hero")] });
    const route = shownOnRoute(deps);
    expect(route).toMatchObject({
      method: "GET",
      path: SHOWN_ON_ROUTE_PATH,
      checksAccess: true,
      noStore: true,
    });
    const response = await route.handler(
      new Request(`http://site${shownOnPath("homepage", true)}`),
      { params: { slug: "homepage" } } as unknown as PluginRouteContext
    );
    expect(
      ((await response.json()) as { places: unknown[] }).places
    ).toHaveLength(1);
    expect(shownOnPath("a b")).toBe("/singles/a%20b/shown-on");
  });
});
