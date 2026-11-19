/**
 * Which starter pages a site offers now, and the copy one gives a new page:
 * a starter needing a block, a variable or a shared style the site no longer
 * has is listed as unavailable with why, and refused at create in the same
 * words, and a copy is the page's own, under new ids, leaving the starter as
 * it was.
 *
 * @module starter-pages/starter-offer.test
 */
import {
  createBlockRegistry,
  walkNodes,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { describe, expect, it } from "vitest";

import { starterMisfitReason, type StarterSite } from "./starter-fit";
import { starterOffers, starterPageCopy, takesPages } from "./starter-offer";
import { FIXTURE_VARIABLE, fixtureStarter } from "./starter-pages.fixture";
import type { RegisteredStarterPage } from "./starter-pages";
import { starterPagesSource } from "./starter-pages-route";

const blocks = createBlockRegistry();
blocks.register(coreBlocks, { source: "@nextlyhq/plugin-page-builder" });

/** A starter as a boot registered it. */
function registered(id: string, over: Partial<RegisteredStarterPage> = {}) {
  return {
    starter: fixtureStarter(id),
    source: "pageBuilder({ starterPages })",
    builtIn: false,
    ...over,
  };
}

/** Every node id in a document, in order. */
function idsOf(nodes: readonly BlockNode[]): string[] {
  const ids: string[] = [];
  walkNodes([...nodes], node => {
    ids.push(node.id);
  });
  return ids;
}

const hasBrand = new Set([FIXTURE_VARIABLE, "color.text"]);
const NO_STYLES: ReadonlySet<string> = new Set();

/** The fixture with its heading wearing the shared style `id`. */
function wearing(id: string): RegisteredStarterPage {
  const entry = registered("styled");
  const [section] = entry.starter.blocks;
  const [title, ...rest] = section?.slots?.children ?? [];
  return {
    ...entry,
    starter: {
      ...entry.starter,
      blocks: [
        {
          ...(section as BlockNode),
          slots: {
            children: [{ ...(title as BlockNode), classes: [id] }, ...rest],
          },
        },
      ],
    },
  };
}

/** Each starter as offered: its id, and why it isn't available, if it isn't. */
function offers(
  registeredList: readonly RegisteredStarterPage[],
  site: StarterSite
): Array<[string, string | undefined]> {
  return starterOffers(registeredList, site).map(offer => [
    offer.entry.starter.id,
    offer.misfit === undefined ? undefined : starterMisfitReason(offer.misfit),
  ]);
}

describe("the starter pages a site offers", () => {
  it("offers a starter whose blocks and variables the site has", () => {
    expect(
      offers([registered("a"), registered("b")], {
        blocks,
        variables: hasBrand,
        sharedStyles: NO_STYLES,
      })
    ).toEqual([
      ["a", undefined],
      ["b", undefined],
    ]);
  });

  it("lists a starter needing a variable the site no longer has as unavailable, saying so", () => {
    expect(
      offers([registered("a")], {
        blocks,
        variables: new Set(["color.text"]),
        sharedStyles: NO_STYLES,
      })
    ).toEqual([["a", "Uses a variable this site doesn't have."]]);
  });

  it("lists a starter needing a block the site no longer has as unavailable, naming the block", () => {
    const fewer = createBlockRegistry();
    fewer.register(
      coreBlocks.filter(block => block.name !== "core/button"),
      { source: "@nextlyhq/plugin-page-builder" }
    );
    expect(
      offers([registered("a")], {
        blocks: fewer,
        variables: hasBrand,
        sharedStyles: NO_STYLES,
      })
    ).toEqual([["a", "Uses the Button block, which this site doesn't have."]]);
  });

  it("lists a starter wearing a shared style the site doesn't have as unavailable, and offers it once the site has it", () => {
    const styled = [wearing("c-hero-title")];
    expect(
      offers(styled, {
        blocks,
        variables: hasBrand,
        sharedStyles: new Set(["c-other"]),
      })
    ).toEqual([["styled", "Uses a shared style this site doesn't have."]]);
    expect(
      offers(styled, {
        blocks,
        variables: hasBrand,
        sharedStyles: new Set(["c-hero-title"]),
      })
    ).toEqual([["styled", undefined]]);
  });

  it("offers starters only to a field that holds pages", () => {
    expect(takesPages(undefined)).toBe(true);
    expect(takesPages(["page", "template"])).toBe(true);
    expect(takesPages(["component"])).toBe(false);
    expect(takesPages([])).toBe(false);
  });
});

describe("the copy a starter gives a new page", () => {
  it("is the starter's blocks under new ids, and leaves the starter as it was", () => {
    const starter = fixtureStarter();
    const before = structuredClone(starter);
    const copy = starterPageCopy(starter, blocks) as BlockDocument;

    expect(copy.kind).toBe("page");
    const starterIds = idsOf(starter.blocks);
    const copyIds = idsOf(copy.nodes);
    expect(copyIds).toHaveLength(starterIds.length);
    for (const id of copyIds) expect(starterIds).not.toContain(id);
    // The same blocks, their props and styles as written.
    expect(
      copy.nodes[0]?.slots?.children?.map(node => [node.type, node.props])
    ).toEqual(
      (starter.blocks[0] as BlockNode).slots?.children?.map(node => [
        node.type,
        node.props,
      ])
    );
    // Copied, not shared: changing the page leaves the starter alone.
    (copy.nodes[0] as { props: Record<string, unknown> }).props.as = "div";
    expect(starter).toEqual(before);
  });

  it("gives two pages two copies, sharing no id", () => {
    const starter = fixtureStarter();
    const first = idsOf(
      (starterPageCopy(starter, blocks) as BlockDocument).nodes
    );
    const second = idsOf(
      (starterPageCopy(starter, blocks) as BlockDocument).nodes
    );
    for (const id of second) expect(first).not.toContain(id);
  });
});

describe("the source the routes answer from", () => {
  const source = (
    variables: ReadonlySet<string>,
    sharedStyles: ReadonlySet<string> = NO_STYLES,
    starters: RegisteredStarterPage[] = [registered("a")]
  ) =>
    starterPagesSource({
      registered: () => starters,
      blocks,
      defined: async () => ({ variables, sharedStyles }),
    });

  it("lists a starter with its name, description and blocks as a page", async () => {
    expect(await source(hasBrand).list()).toEqual([
      {
        id: "a",
        label: "Welcome",
        description: fixtureStarter().description,
        document: {
          formatVersion: 1,
          kind: "page",
          nodes: fixtureStarter().blocks,
        },
      },
    ]);
  });

  it("copies a starter the site can use, and refuses one it can't in the words the list shows", async () => {
    expect(await source(hasBrand).copy("a")).toMatchObject({
      document: { kind: "page" },
    });
    expect(await source(hasBrand).copy("gone")).toBeUndefined();
    expect(await source(hasBrand).copy("a", ["component"])).toBeUndefined();
    // Without the variable it names, it is listed as unavailable, and a
    // page made from it is refused with the same reason.
    const without = source(new Set());
    expect((await without.list()).map(item => item.unavailable)).toEqual([
      { reason: "Uses a variable this site doesn't have." },
    ]);
    expect(await without.copy("a")).toEqual({
      unavailable: `The starter page "${fixtureStarter("a").label}" isn't available on this site. Uses a variable this site doesn't have.`,
    });
    // A starter whose shared style is gone: listed, unavailable, not copied.
    const styled = source(hasBrand, new Set(["c-other"]), [
      wearing("c-hero-title"),
    ]);
    expect((await styled.list()).map(item => item.unavailable)).toEqual([
      { reason: "Uses a shared style this site doesn't have." },
    ]);
    expect(await styled.copy("styled")).toHaveProperty("unavailable");
  });
});
