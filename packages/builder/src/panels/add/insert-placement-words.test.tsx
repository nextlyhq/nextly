// @vitest-environment jsdom

/**
 * The words that say where the next block lands, for each kind of place:
 * "Adding inside Hero, at the end", "Adding after Heading, inside Hero",
 * "Adding at the end of the page", "Adding between Hero and Pricing".
 *
 * @module insert-placement-words.test
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import {
  insertedAnnouncement,
  placeWords,
  placementWords,
} from "./insert-placement-words";
import type { InsertionCandidate } from "./insertion-candidates";

afterEach(cleanup);

function node(
  id: string,
  type: string,
  name?: string,
  children?: BlockNode[]
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props: {},
    ...(name === undefined ? {} : { name }),
    ...(children === undefined ? {} : { slots: { children } }),
  } as BlockNode;
}

/** Hero (a Section an author named) holding a Heading, then Pricing. */
const document = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    node("hero", "core/section", "Hero", [node("h", "core/heading")]),
    node("pricing", "core/section", "Pricing"),
  ],
} as BlockDocument;

const end: InsertionCandidate = {
  kind: "document-end",
  at: { index: 2 },
  target: { kind: "root" },
};
const insideHero: InsertionCandidate = {
  kind: "inside",
  at: { parentId: "hero", slot: "children", index: 1 },
  target: { kind: "slot", parentType: "core/section", slot: "children" },
  insideId: "hero",
};
const afterHero: InsertionCandidate = {
  kind: "after-selection",
  at: { index: 1 },
  target: { kind: "root" },
  afterId: "hero",
};
const afterHeading: InsertionCandidate = {
  kind: "after-selection",
  at: { parentId: "hero", slot: "children", index: 1 },
  target: { kind: "slot", parentType: "core/section", slot: "children" },
  afterId: "h",
};
const betweenHeroAndPricing: InsertionCandidate = {
  kind: "between",
  at: { index: 1 },
  target: { kind: "root" },
  afterId: "hero",
  beforeId: "pricing",
};
const beforeHeading: InsertionCandidate = {
  kind: "between",
  at: { parentId: "hero", slot: "children", index: 0 },
  target: { kind: "slot", parentType: "core/section", slot: "children" },
  beforeId: "h",
};

describe("where a place is, in words", () => {
  it("says each kind of place, naming the block it is in when not at the top", () => {
    expect(placeWords(document, end)).toBe("at the end of the page");
    expect(placeWords(document, insideHero)).toBe("inside Hero, at the end");
    expect(placeWords(document, afterHero)).toBe("after Hero");
    expect(placeWords(document, afterHeading)).toBe(
      "after Heading, inside Hero"
    );
    expect(placeWords(document, betweenHeroAndPricing)).toBe(
      "between Hero and Pricing"
    );
    expect(placeWords(document, beforeHeading)).toBe(
      "before Heading, inside Hero"
    );
  });

  it("leads the panel's line with Adding, and makes the places bold", () => {
    const { container } = render(
      <p>{placementWords("Adding", document, afterHeading)}</p>
    );
    expect(container.textContent).toBe("Adding after Heading, inside Hero");
    expect(
      [...container.querySelectorAll("b")].map(bold => bold.textContent)
    ).toEqual(["after Heading", "inside Hero"]);
  });

  it("says the end of the page plainly, with nothing bold", () => {
    const { container } = render(
      <p>{placementWords("Adding", document, end)}</p>
    );
    expect(container.textContent).toBe("Adding at the end of the page");
    expect(container.querySelector("b")).toBeNull();
  });

  it("announces an insert by the block and where it went", () => {
    expect(insertedAnnouncement("Heading", document, insideHero)).toBe(
      "Heading added inside Hero, at the end"
    );
    expect(insertedAnnouncement("Section", document, afterHero)).toBe(
      "Section added after Hero"
    );
    expect(insertedAnnouncement("Text", document, end)).toBe(
      "Text added at the end of the page"
    );
  });
});
