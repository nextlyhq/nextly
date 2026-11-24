/**
 * Which reloaded entities a field that looks moved holds back, what each is told, and how a hold
 * for a move joins one for a type change on the same entity.
 */
import { describe, expect, it } from "vitest";

import { movesHeldBack, withMovesHeldBack } from "../code-first-moves";

const text = (name: string) => ({ name, type: "text" });
const group = (name: string, fields: object[]) => ({
  name,
  type: "group",
  fields,
});

describe("movesHeldBack", () => {
  it("holds an entity whose field moved into a group, saying the push would delete it", () => {
    const [held] = movesHeldBack([
      {
        kind: "collection",
        slug: "posts",
        recordedFields: [text("subtitle"), group("meta", [])],
        fields: [group("meta", [text("subtitle")])],
      },
    ]);
    expect(held?.slug).toBe("posts");
    expect(held?.reasons).toEqual([
      expect.stringMatching(
        /^subtitle looks moved to meta\.subtitle, and the development push would delete subtitle with its values\. Run nextly migrate:create/
      ),
    ]);
  });

  it("says a field moved out of a group or between groups would be left where nothing reads it", () => {
    const out = movesHeldBack([
      {
        kind: "single",
        slug: "home",
        recordedFields: [group("meta", [text("subtitle")])],
        fields: [text("subtitle"), group("meta", [])],
      },
    ]);
    expect(out[0]?.reasons[0]).toMatch(
      /would add subtitle empty, leaving its values in the group/
    );
    const between = movesHeldBack([
      {
        kind: "fieldGroup",
        slug: "card",
        recordedFields: [group("a", [text("x")]), group("b", [])],
        fields: [group("a", []), group("b", [text("x")])],
      },
    ]);
    expect(between[0]?.reasons[0]).toMatch(
      /would start b\.x empty, leaving its values at a\.x, where nothing reads them/
    );
  });

  it("holds nothing for an entity new to the registry, or one whose fields only changed in place", () => {
    expect(
      movesHeldBack([
        { kind: "collection", slug: "new", fields: [text("subtitle")] },
        {
          kind: "collection",
          slug: "same",
          recordedFields: [text("subtitle")],
          fields: [text("subtitle"), text("added")],
        },
      ])
    ).toEqual([]);
  });
});

describe("withMovesHeldBack", () => {
  it("names an entity held for both once, its type change's reasons first", () => {
    expect(
      withMovesHeldBack(
        [{ kind: "collection", slug: "posts", reasons: ["type"] }],
        [
          { kind: "collection", slug: "posts", reasons: ["move"] },
          { kind: "single", slug: "posts", reasons: ["other"] },
        ]
      )
    ).toEqual([
      { kind: "collection", slug: "posts", reasons: ["type", "move"] },
      { kind: "single", slug: "posts", reasons: ["other"] },
    ]);
  });
});
