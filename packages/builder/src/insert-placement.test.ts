/**
 * The Add panel offers what the one placement rule would accept where the
 * block goes: nothing clickable under a linked card, though a Button is
 * offered everywhere else.
 */
import {
  allBlocks,
  clearBlocks,
  placementSiteIn,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { allowedEntries, catalogFrom } from "./inserter";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "t/card",
        slots: { children: {} },
        contentModel: (props: { link?: string }) =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "t/button",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "t/heading" },
      {
        ...base,
        name: "t/accordion",
        // Plain flow itself, and seeded with a Button: what the insert builds
        // is clickable even though the block's own props say nothing of it.
        slots: { items: { defaultBlock: [{ type: "t/button" }] } },
        contentModel: () => ({ is: ["flow"] }),
      },
    ] as never,
    { source: "test" }
  );
});

afterEach(() => {
  clearBlocks();
});

function offeredInside(card: BlockNode): string[] {
  const sources = {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
  };
  const site = placementSiteIn(
    [card],
    { kind: "slot", parentId: card.id, slot: "children" },
    sources
  );
  if (site === undefined) throw new Error("no site");
  return allowedEntries(
    catalogFrom(allBlocks()),
    { kind: "slot", parentType: card.type, slot: "children" },
    registryNestingSource(),
    undefined,
    {
      site,
      sources,
      expansion: { definitions: registryBlockSource(), nesting: undefined },
    }
  ).map(entry => entry.blockName);
}

describe("the Add panel under the one placement rule", () => {
  it("leaves out a Button inside a linked card, and keeps the rest", () => {
    const linked: BlockNode = {
      id: "c",
      type: "t/card",
      version: 1,
      props: { link: "/go" },
    };
    const offered = offeredInside(linked);
    expect(offered).not.toContain("t/button");
    expect(offered).toContain("t/heading");
  });

  it("offers the Button inside the same card with its link off", () => {
    const plain: BlockNode = { id: "c", type: "t/card", version: 1, props: {} };
    expect(offeredInside(plain)).toContain("t/button");
  });

  it("judges a block with the children its insert seeds, not as an empty shell", () => {
    // The Accordion alone is plain flow; the Button its slot starts with is
    // what the linked card refuses. Judged as `{ type, props }` it is offered
    // and the click that follows is refused.
    const linked: BlockNode = {
      id: "c",
      type: "t/card",
      version: 1,
      props: { link: "/go" },
    };
    expect(offeredInside(linked)).not.toContain("t/accordion");
  });

  it("offers the same Accordion inside the card with its link off", () => {
    // The control: the Accordion is in the catalog and placeable, so its
    // absence above is the seeded Button's doing.
    const plain: BlockNode = { id: "c", type: "t/card", version: 1, props: {} };
    expect(offeredInside(plain)).toContain("t/accordion");
  });
});
