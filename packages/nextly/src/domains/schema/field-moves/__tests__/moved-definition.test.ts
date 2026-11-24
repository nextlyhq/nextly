/**
 * The definition a move's first step leaves: the fields as they were, with each move made and nothing
 * else changed. What the second step then makes of it is the full after-definition.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { fieldsWithMoves } from "../moved-definition";

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, type: "text", ...extra }) as FieldDefinition;
const group = (name: string, fields: FieldDefinition[], extra = {}) =>
  ({ name, type: "group", fields, ...extra }) as unknown as FieldDefinition;

describe("the definition a move's first step leaves", () => {
  const before = [
    text("title"),
    text("summary", { required: true }),
    group("meta", [text("note"), text("subtitle", { required: true })]),
  ];

  it("takes a field off the row into a group, Required as it was, placed as the change has it", () => {
    const after = [
      text("title"),
      group("meta", [
        text("summary", { required: true }),
        text("note"),
        text("subtitle", { required: true }),
      ]),
    ];
    expect(
      fieldsWithMoves(before, after, [
        { from: ["summary"], to: ["meta", "summary"] },
      ])
    ).toEqual(after);
  });

  it("puts a field moved out of a group on the row, not Required until its values are in", () => {
    const after = [
      text("title"),
      text("summary", { required: true }),
      text("subtitle", { required: true }),
      group("meta", [text("note")]),
    ];
    expect(
      fieldsWithMoves(before, after, [
        { from: ["meta", "subtitle"], to: ["subtitle"] },
      ])
    ).toEqual([
      text("title"),
      text("summary", { required: true }),
      text("subtitle", { required: false }),
      group("meta", [text("note")]),
    ]);
  });

  it("leaves exactly the after-definition of a change that only moves: two fields out, in order", () => {
    const grouped = [
      text("title"),
      group("meta", [text("note"), text("a"), text("b")]),
    ];
    const after = [
      text("title"),
      text("a"),
      text("b"),
      group("meta", [text("note")]),
    ];
    expect(
      fieldsWithMoves(grouped, after, [
        { from: ["meta", "b"], to: ["b"] },
        { from: ["meta", "a"], to: ["a"] },
      ])
    ).toEqual(after);
  });

  it("moves between groups, through a group with no name on the way", () => {
    const layout = (outer: FieldDefinition[]) =>
      group("", [group("outer", [group("inner", outer)])]);
    const a = text("a", { required: true });
    const after = [layout([]), group("other", [text("b"), a])];
    expect(
      fieldsWithMoves([layout([a]), group("other", [text("b")])], after, [
        { from: ["outer", "inner", "a"], to: ["other", "a"] },
      ])
    ).toEqual(after);
  });

  it("stands a field moved into a group the same change adds in that group, with nothing else the change adds", () => {
    const after = [
      text("title"),
      group("meta", [
        text("note"),
        text("subtitle", { required: true }),
        group("inner", [text("new"), text("summary", { required: true })]),
      ]),
    ];
    expect(
      fieldsWithMoves(before, after, [
        { from: ["summary"], to: ["meta", "inner", "summary"] },
      ])
    ).toEqual([
      text("title"),
      group("meta", [
        text("note"),
        text("subtitle", { required: true }),
        group("inner", [text("summary", { required: true })]),
      ]),
    ]);
  });

  it("keeps every other change of the same save out: a field deleted, added or changed", () => {
    const after = [
      text("title", { label: "Headline" }),
      text("added"),
      group("meta", [text("subtitle"), text("summary", { required: true })]),
    ];
    expect(
      fieldsWithMoves(before, after, [
        { from: ["summary"], to: ["meta", "summary"] },
      ])
    ).toEqual([
      text("title"),
      group("meta", [
        text("note"),
        text("subtitle", { required: true }),
        text("summary", { required: true }),
      ]),
    ]);
  });

  it("with no moves, the fields are as they were", () => {
    expect(fieldsWithMoves(before, before, [])).toEqual(before);
  });
});
