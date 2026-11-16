import { allBlocks, clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, describe, expect, it } from "vitest";

import { withBlockLooks, withRegisteredLooks } from "./core-looks";
import { resolveSiteStyle, type SiteStyleData } from "./site-style";
import { loadSiteStyle } from "./site-style-load";
import { readSiteStyleRecord } from "./site-style-record";
import type { SiteStyleReader } from "./site-style-storage";

/** A site that has stored nothing: its single reads as an empty document. */
const nothingStored: SiteStyleReader = { findSingle: async () => null };

/** Every look the core blocks offer an author, by the id a node stores. */
const CORE_LOOKS = [
  "look:core/section:hero",
  "look:core/button:secondary",
  "look:core/button:outline",
  "look:core/button:text",
  "look:core/image:rounded",
  "look:core/image:circle",
];

/** A block another plugin declares, with one look of its own. */
const acmeHero = (() => {
  const section = coreBlocks.find(block => block.name === "core/section");
  if (section === undefined) throw new Error("no core section");
  return {
    ...section,
    name: "acme/hero",
    editor: {
      ...section.editor,
      variations: [
        {
          name: "dark",
          label: "Dark",
          styles: { base: { base: { color: "white" } } },
        },
      ],
    },
  };
})();

const idsOf = (style: { classes?: readonly { id: string }[] }): string[] =>
  (style.classes ?? []).map(entry => entry.id);

afterEach(() => {
  clearBlocks();
});

describe("the site style a published page loads", () => {
  it("holds every look the core blocks supply, with no defaults stated", async () => {
    const style = await loadSiteStyle({ nextly: nothingStored });
    expect(idsOf(style)).toEqual(expect.arrayContaining(CORE_LOOKS));
  });

  it("holds every look the core blocks supply beside a host's own defaults", async () => {
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    const style = await loadSiteStyle({
      nextly: nothingStored,
      defaults: { classes: [card] },
    });
    expect(idsOf(style)).toEqual(
      expect.arrayContaining(["c-card", ...CORE_LOOKS])
    );
  });

  it("holds the same looks the canvas reads, other plugins' blocks among them", async () => {
    registerBlocks(coreBlocks, { source: "page-builder" });
    registerBlocks([acmeHero], { source: "acme" });
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    const hostDefaults = { classes: [card] };
    const published = await loadSiteStyle({
      nextly: nothingStored,
      defaults: hostDefaults,
    });
    // The canvas's own set, built the way it reaches the canvas: the plugin
    // sends its code tier (the host's style with every registered block's
    // looks, resolved), and the editor adds its registry's looks to that.
    const sent = resolveSiteStyle(withBlockLooks(hostDefaults, allBlocks()));
    const canvas = resolveSiteStyle(
      withRegisteredLooks(readSiteStyleRecord(sent))
    );
    const looks = (style: SiteStyleData) =>
      (style.classes ?? []).filter(entry => entry.id.startsWith("look:"));
    // Whole entries, so a look whose styles, order or block type differed
    // between the two would show here, not only a missing one.
    expect(looks(published)).toEqual(looks(canvas));
    expect(idsOf(published)).toEqual(
      expect.arrayContaining([...CORE_LOOKS, "look:acme/hero:dark"])
    );
  });

  it("takes the looks of blocks that register while the read boots the site", async () => {
    // A host's reader starts the site on its first read, and the site's
    // plugins register their blocks as it starts.
    const bootingReader: SiteStyleReader = {
      findSingle: async () => {
        registerBlocks([...coreBlocks, acmeHero], { source: "boot" });
        return null;
      },
    };
    expect(allBlocks()).toEqual([]);
    const style = await loadSiteStyle({ nextly: bootingReader });
    expect(idsOf(style)).toContain("look:acme/hero:dark");
  });

  it("serves the site's stored edit of a look over the code's", async () => {
    const stored = {
      classes: [
        {
          id: "look:core/section:hero",
          slug: "section-hero",
          orderIndex: 0,
          blockType: "core/section",
          styles: { base: { base: { color: "rebeccapurple" } } },
        },
      ],
    };
    const style = await loadSiteStyle({
      nextly: { findSingle: async () => stored },
    });
    const hero = style.classes?.filter(
      entry => entry.id === "look:core/section:hero"
    );
    expect(hero).toHaveLength(1);
    expect(hero?.[0]?.styles).toEqual(stored.classes[0]?.styles);
  });
});
