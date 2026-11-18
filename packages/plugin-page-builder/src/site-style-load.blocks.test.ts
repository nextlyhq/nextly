/**
 * `loadSiteStyle` takes its looks from the started site's blocks wherever the
 * blocks it is handed are bound to a page builder that did not start in this
 * module copy, as a production route's are, and from the blocks handed to it
 * otherwise.
 */
import {
  createBlockRegistry,
  type AnyBlockDefinition,
} from "@nextlyhq/blocks-engine";
import { SITE_BLOCKS_SERVICE, SITE_COPY } from "@nextlyhq/blocks-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSiteStyle } from "./site-style-load";

/** What the started instance offers, per test. */
let offered: Record<string, Record<string, unknown>> = {};

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({ plugins: offered }),
}));

afterEach(() => {
  offered = {};
});

/** A block offering one look, `name`'s "dark". */
function lookBlock(name: string): AnyBlockDefinition {
  return {
    name,
    version: 1,
    description: name,
    example: { props: {} },
    editor: {
      variations: [
        {
          name: "dark",
          label: "Dark",
          styles: { base: { base: { color: "black" } } },
        },
      ],
    },
    render: () => null,
  } as unknown as AnyBlockDefinition;
}

const nothingStored = { findSingle: async () => null };

const lookIds = (classes: readonly { id: string }[] | undefined) =>
  (classes ?? [])
    .map(entry => entry.id)
    .filter(id => id.startsWith("look:acme"));

describe("the site style's looks", () => {
  it("come from the started site where the blocks are bound to a copy that never started", async () => {
    const started = createBlockRegistry();
    started.register([lookBlock("acme/started")]);
    offered = {
      [SITE_BLOCKS_SERVICE.plugin]: { [SITE_BLOCKS_SERVICE.service]: started },
    };
    const unstarted = Object.assign(
      {
        all: () => {
          throw new Error("an unstarted copy was read");
        },
      },
      { [SITE_COPY]: { started: () => false } }
    );
    const style = await loadSiteStyle({
      nextly: nothingStored,
      blocks: unstarted,
    });
    expect(lookIds(style.classes)).toEqual(["look:acme/started:dark"]);
  });

  it("come from the blocks handed over where those started here", async () => {
    const own = createBlockRegistry();
    own.register([lookBlock("acme/own")]);
    const style = await loadSiteStyle({
      nextly: nothingStored,
      blocks: Object.assign(own, { [SITE_COPY]: { started: () => true } }),
    });
    expect(lookIds(style.classes)).toEqual(["look:acme/own:dark"]);
  });
});
