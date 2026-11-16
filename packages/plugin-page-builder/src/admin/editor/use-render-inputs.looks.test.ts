// @vitest-environment jsdom

/**
 * The looks the editor's canvas draws with are the looks a published page
 * loads.
 *
 * The canvas takes its site style from `useSiteStyleInputs`, fed with the
 * client config the plugin publishes; a published page takes its own from
 * `loadSiteStyle`. The canvas's side is what the real hook answers, handed
 * the config through the JSON trip the admin delivers it by. The config's
 * site style is the code tier as init refreshes it; `site-style-load.test`
 * holds that `adminClientConfig` publishes exactly that tier, in a node
 * environment, since the plugin's options module is server-only. A hook that
 * dropped, reordered or altered a look would draw a block one way on the
 * canvas and another on the live page.
 *
 * Only the network is replaced: the stored site style read, and the admin
 * hooks the site style client asks for its writes, which no case here makes.
 *
 * @module admin/editor/use-render-inputs.looks.test
 */
import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SiteStyleData } from "../../site-style";
import type { SiteStyleReader } from "../../site-style-storage";

/** What the stored site style read answers for the case in hand. */
let stored: unknown;

vi.mock("../site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: stored,
    isPending: false,
    error: null,
    refetch: async () => ({ isError: false }),
    readFresh: async () => stored,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  // The host's font table, which the real entry re-exports from core.
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  apiErrorMessage: () => "",
  validationIssues: () => [],
  readPluginRoute: async () => undefined,
  writePluginRoute: async () => undefined,
  useTrackedWrite: () => () => {},
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

const { withRegisteredLooks } = await import("../../core-looks");
const { resolveSiteStyle } = await import("../../site-style");
const { loadSiteStyle } = await import("../../site-style-load");
const { useSiteStyleInputs } = await import("./use-render-inputs");

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

/** A host's own stated defaults: one class of its own. */
const HOST_DEFAULTS: SiteStyleData = {
  classes: [{ id: "c-card", slug: "card", orderIndex: 0, styles: {} }],
};

/**
 * The client config the plugin publishes, once init has registered every
 * block and refreshed the code tier, as the admin hands it to the editor.
 */
function publishedClientConfig(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      siteStyle: {
        classes: resolveSiteStyle(withRegisteredLooks(HOST_DEFAULTS)).classes,
      },
    })
  ) as Record<string, unknown>;
}

const looksOf = (style: SiteStyleData) =>
  (style.classes ?? []).filter(entry => entry.id.startsWith("look:"));

afterEach(() => {
  clearBlocks();
  stored = undefined;
});

describe("the looks the canvas draws with", () => {
  it("are the published page's looks, whole and in order, other plugins' among them", async () => {
    registerBlocks(coreBlocks, { source: "page-builder" });
    registerBlocks([acmeHero], { source: "acme" });
    const nothingStored: SiteStyleReader = { findSingle: async () => null };
    const published = await loadSiteStyle({
      nextly: nothingStored,
      defaults: HOST_DEFAULTS,
    });

    const { result } = renderHook(() =>
      useSiteStyleInputs(publishedClientConfig())
    );
    const canvas = result.current.canvasSiteStyle;

    // Whole entries, so a look whose styles, order or block type differed
    // between the two would show here, not only a missing one.
    expect(looksOf(canvas)).toEqual(looksOf(published));
    expect(looksOf(canvas).map(entry => entry.id)).toEqual(
      expect.arrayContaining([
        "look:core/section:hero",
        "look:core/image:rounded",
        "look:acme/hero:dark",
      ])
    );
  });

  it("are the published page's looks where the site stored its own edit of one", async () => {
    registerBlocks(coreBlocks, { source: "page-builder" });
    stored = {
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
    const published = await loadSiteStyle({
      nextly: { findSingle: async () => stored },
      defaults: HOST_DEFAULTS,
    });

    const { result } = renderHook(() =>
      useSiteStyleInputs(publishedClientConfig())
    );

    expect(looksOf(result.current.canvasSiteStyle)).toEqual(
      looksOf(published)
    );
  });
});
