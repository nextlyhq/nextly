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

// A move that can never be made as it is says why, in the Schema Builder's words: today's text
// says to run migrate:create, which refuses it.
describe("a move the push can say is refused for what it is", () => {
  const unique = { ...text("code"), unique: true };
  const repeater = (name: string, fields: object[]) => ({
    name,
    type: "repeater",
    fields,
  });
  const held = (recordedFields: object[], fields: object[]) =>
    movesHeldBack([
      { kind: "collection", slug: "posts", recordedFields, fields },
    ])[0]?.reasons;

  it.each([
    ["a group", "group", "meta", group("meta", [])],
    ["a repeater", "repeater", "items", repeater("items", [])],
  ] as const)(
    "a field kept unique into %s",
    (_what, noun, holder, container) => {
      const reasons = held(
        [unique, container],
        [
          {
            ...container,
            fields: [...container.fields, unique],
          },
        ]
      );
      expect(reasons).toEqual([
        `code cannot be moved into the ${noun} ${holder}: a ${noun} keeps its values in one JSON value, which cannot be kept unique. It can be moved once it is no longer unique (a one-to-one changed to many-to-one, or its unique setting removed), as a change of its own. The change was not applied.`,
      ]);
    }
  );

  it("a one-to-one relationship, translated or not, into a group", () => {
    const person = (extra: object = {}) => ({
      name: "person",
      type: "relationship",
      relationTo: "people",
      unique: true,
      ...extra,
    });
    for (const moved of [person(), person({ localized: true })]) {
      expect(
        held([moved, group("meta", [])], [group("meta", [moved])])
      ).toEqual([
        expect.stringMatching(
          /^person cannot be moved into the group meta: a group keeps its values in one JSON value, which cannot be kept unique\. .* The change was not applied\.$/
        ),
      ]);
    }
  });

  it("a field out of a repeater, whose entries hold several rows of it", () => {
    expect(
      held(
        [repeater("items", [text("label")])],
        [text("label"), repeater("items", [])]
      )
    ).toEqual([
      expect.stringMatching(
        /^label cannot be moved out of the repeating rows items: each entry may hold several rows of it, which one field cannot keep\. Add a new field instead\. The change was not applied\.$/
      ),
    ]);
  });

  // What the push cannot answer keeps its own words: a field that changes how it stores its values
  // is refused for that only by a road that knows how each is stored.
  it("keeps its own words for a move it refuses for a reason it cannot give", () => {
    const views = (fractions: boolean) => ({
      name: "views",
      type: "number",
      ...(fractions ? { dbType: "decimal" } : {}),
    });
    expect(
      held([views(false), group("meta", [])], [group("meta", [views(true)])])
    ).toEqual([
      expect.stringMatching(
        /^views looks moved to meta\.views, and the development push would delete views with its values\. Run nextly migrate:create/
      ),
    ]);
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
