/**
 * What the component editor is told about the component it edits.
 *
 * The properties a plausible implementation gets wrong: reading the ids from
 * the wrong field or from the draft instead of the live row, a failed count
 * that takes the live ids down with it, and a malformed stored row that
 * throws where it should answer nothing.
 */
import { describe, expect, it } from "vitest";

import { liveIdsOf, readComponentFacts } from "./component-facts-route";

const row = {
  id: "hero",
  title: "Hero",
  content: {
    formatVersion: 1,
    kind: "component",
    nodes: [],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "h",
        propPath: "text",
        type: "text",
      },
      { id: "cta", label: "CTA", nodeId: "b", propPath: "href", type: "link" },
    ],
    slots: { body: { label: "Body", nodeId: "box", slot: "children" } },
  },
};

describe("the live ids", () => {
  it("are every field and slot id the live definition holds", () => {
    expect(liveIdsOf(row, "content")).toEqual({
      properties: ["title", "cta"],
      slots: ["body"],
    });
  });

  it("are read from the store's own field", () => {
    expect(liveIdsOf(row, "definition")).toEqual({
      properties: [],
      slots: [],
    });
  });

  it("skip what a hand-written row holds in place of an id", () => {
    expect(
      liveIdsOf(
        { content: { exposed: [null, { id: 4 }, { id: "ok" }], slots: [] } },
        "content"
      )
    ).toEqual({ properties: ["ok"], slots: [] });
    expect(liveIdsOf(null, "content")).toEqual({ properties: [], slots: [] });
  });
});

describe("the answer", () => {
  it("carries the count, and says when it is a floor", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 3, complete: false }),
      field: "content",
    });
    expect(facts).toEqual({
      live: { properties: ["title", "cta"], slots: ["body"] },
      reach: { count: 3, complete: false },
    });
  });

  it("keeps the live ids when the count fails", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => {
        throw new Error("the index is unavailable");
      },
      field: "content",
    });
    expect(facts.live.properties).toEqual(["title", "cta"]);
    expect(facts.reach).toBeNull();
  });

  it("asks the live read for the component named", async () => {
    const asked: string[] = [];
    await readComponentFacts("hero", {
      readLive: async id => {
        asked.push(id);
        return null;
      },
      countPlacements: async () => ({ documents: 0, complete: true }),
      field: "content",
    });
    expect(asked).toEqual(["hero"]);
  });
});
