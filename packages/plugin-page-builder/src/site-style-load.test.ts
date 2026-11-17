import { createBlockRegistry } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, describe, expect, it } from "vitest";

import { withRegisteredLooks } from "./core-looks";
import {
  adminClientConfig,
  refreshCodeTier,
} from "./plugin-definition/options";
import { resolveSiteStyle, type SiteStyleData } from "./site-style";
import { loadSiteStyle } from "./site-style-load";
import type { SiteStyleReader } from "./site-style-storage";

/** The site's block registry these tests register into and load with. */
const blocks = createBlockRegistry();

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
  blocks.clear();
});

describe("the site style a published page loads", () => {
  it("holds every look the core blocks supply, with no defaults stated", async () => {
    const style = await loadSiteStyle({ nextly: nothingStored, blocks });
    expect(idsOf(style)).toEqual(expect.arrayContaining(CORE_LOOKS));
  });

  it("holds every look the core blocks supply beside a host's own defaults", async () => {
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    const style = await loadSiteStyle({
      nextly: nothingStored,
      blocks,
      defaults: { classes: [card] },
    });
    expect(idsOf(style)).toEqual(
      expect.arrayContaining(["c-card", ...CORE_LOOKS])
    );
  });

  it("publishes to the editor the code tier init refreshed, other plugins' looks among them", async () => {
    blocks.register(coreBlocks, { source: "page-builder" });
    blocks.register([acmeHero], { source: "acme" });
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    const hostDefaults = { classes: [card] };
    // As the plugin runs it: one shared object, refreshed at init once every
    // block registered, then published as the admin's client config.
    const configStyle: SiteStyleData = {};
    const published = adminClientConfig(
      { siteStyle: hostDefaults },
      { configStyle, canvasPath: undefined, fontsOff: false }
    );
    refreshCodeTier(configStyle, new Set(), hostDefaults, blocks.all());
    const sent = JSON.parse(JSON.stringify(published.clientConfig)) as {
      siteStyle: SiteStyleData;
    };
    // The tier `use-render-inputs.looks.test` hands the editor's real hook,
    // whose looks it holds equal to the published page's.
    expect(sent.siteStyle.classes).toEqual(
      resolveSiteStyle(withRegisteredLooks(hostDefaults, blocks.all())).classes
    );
    expect(idsOf(sent.siteStyle)).toEqual(
      expect.arrayContaining([...CORE_LOOKS, "look:acme/hero:dark"])
    );
  });

  it("takes the looks of blocks that register while the read boots the site", async () => {
    // A host's reader starts the site on its first read, and the site's
    // plugins register their blocks as it starts.
    const bootingReader: SiteStyleReader = {
      findSingle: async () => {
        blocks.register([...coreBlocks, acmeHero], { source: "boot" });
        return null;
      },
    };
    expect(blocks.all()).toEqual([]);
    const style = await loadSiteStyle({ nextly: bootingReader, blocks });
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
      blocks,
    });
    const hero = style.classes?.filter(
      entry => entry.id === "look:core/section:hero"
    );
    expect(hero).toHaveLength(1);
    expect(hero?.[0]?.styles).toEqual(stored.classes[0]?.styles);
  });
});
