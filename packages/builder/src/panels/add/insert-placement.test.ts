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
  type NestingSource,
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

function offeredInside(
  card: BlockNode,
  nesting: NestingSource = registryNestingSource()
): string[] {
  const sources = { nesting, definitions: registryBlockSource() };
  const site = placementSiteIn(
    [card],
    { kind: "slot", parentId: card.id, slot: "children" },
    sources
  );
  if (site === undefined) throw new Error("no site");
  return allowedEntries(
    catalogFrom(allBlocks()),
    { kind: "slot", parentType: card.type, slot: "children" },
    nesting,
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

  it("asks the name rules once per entry, inside the one placement rule", () => {
    // The placement rule already asks a block's parents and the slot's
    // allow-list, so a second, narrower pass over the same rules beside it
    // asks each question twice. Counted per type, which a Heading with no
    // starting children reaches exactly once when the rule is asked once.
    const registry = registryNestingSource();
    const asked = new Map<string, number>();
    const counting: NestingSource = {
      parentsOf: type => {
        asked.set(type, (asked.get(type) ?? 0) + 1);
        return registry.parentsOf(type);
      },
      slotAllowOf: (type, slot) => registry.slotAllowOf?.(type, slot),
    };
    const plain: BlockNode = { id: "c", type: "t/card", version: 1, props: {} };
    // The control: the Heading is offered, so it was judged and counted.
    expect(offeredInside(plain, counting)).toContain("t/heading");
    expect(asked.get("t/heading")).toBe(1);
  });

  it("offers the same Accordion inside the card with its link off", () => {
    // The control: the Accordion is in the catalog and placeable, so its
    // absence above is the seeded Button's doing.
    const plain: BlockNode = { id: "c", type: "t/card", version: 1, props: {} };
    expect(offeredInside(plain)).toContain("t/accordion");
  });
});
