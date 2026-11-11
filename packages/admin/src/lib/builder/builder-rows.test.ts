/**
 * The one rule a field moves by in the Builder's outline, read by the drag,
 * the menu's Move up and Move down, and the drag announcements.
 *
 * The property under test is agreement: what the drop handler applies, the
 * one-step move does, and the announcement says, are the same decision. A
 * field moves among its own siblings, at the top level or at any depth, and
 * never into another container, past a built-in field, or as one.
 *
 * @module lib/builder/builder-rows.test
 */

import type { Active, Over } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderAnnouncements } from "./builder-announcements";
import {
  builderDropAccepted,
  moveWithinContainer,
  placeAmongSiblings,
} from "./builder-rows";

function field(id: string, patch: Partial<BuilderField> = {}): BuilderField {
  return {
    id,
    name: id,
    label: id[0].toUpperCase() + id.slice(1),
    type: "text",
    ...patch,
  };
}

const system = field("id", { isSystem: true });
const fields = (): BuilderField[] => [
  system,
  field("title"),
  field("body"),
  field("meta", {
    type: "group",
    fields: [field("a"), field("b"), field("c")],
  }),
];

const ids = (list: readonly BuilderField[]) => list.map(f => f.id);

describe("which drops are moves", () => {
  it("accepts a field over a sibling, at the top level and inside a group", () => {
    expect(builderDropAccepted(fields(), "title", "body")).toBe(true);
    expect(builderDropAccepted(fields(), "a", "c")).toBe(true);
  });

  it("refuses a drop into another container", () => {
    expect(builderDropAccepted(fields(), "title", "a")).toBe(false);
    expect(builderDropAccepted(fields(), "a", "body")).toBe(false);
  });

  it("refuses a built-in field, either way", () => {
    expect(builderDropAccepted(fields(), "title", "id")).toBe(false);
    expect(builderDropAccepted(fields(), "id", "title")).toBe(false);
  });

  it("refuses a field over itself, or an id that is not a field", () => {
    expect(builderDropAccepted(fields(), "title", "title")).toBe(false);
    expect(builderDropAccepted(fields(), "nope", "title")).toBe(false);
  });
});

describe("a field owned by code or a plugin", () => {
  const withOwned = (): BuilderField[] => [
    field("title"),
    field("rating", { source: "plugin", owner: "@acme/reviews" }),
    field("body"),
    field("tail"),
  ];

  it("is never passed by a drop, which would move it too", () => {
    expect(builderDropAccepted(withOwned(), "title", "body")).toBe(false);
    expect(builderDropAccepted(withOwned(), "tail", "title")).toBe(false);
    // The control: a drop that spans no owned field is still a move.
    expect(builderDropAccepted(withOwned(), "body", "tail")).toBe(true);
  });

  it("is never stepped past, by Move up or Move down", () => {
    const before = withOwned();
    expect(moveWithinContainer(before, "body", -1)).toBe(before);
    expect(moveWithinContainer(before, "title", 1)).toBe(before);
    expect(ids(moveWithinContainer(withOwned(), "tail", -1))).toEqual([
      "title",
      "rating",
      "tail",
      "body",
    ]);
  });
});

describe("a one-step move", () => {
  it("moves a field among its siblings, at any depth", () => {
    expect(ids(moveWithinContainer(fields(), "body", -1))).toEqual([
      "id",
      "body",
      "title",
      "meta",
    ]);
    const moved = moveWithinContainer(fields(), "a", 1);
    expect(ids(moved.find(f => f.id === "meta")?.fields ?? [])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("does nothing at either end, or past a built-in field", () => {
    const before = fields();
    expect(moveWithinContainer(before, "c", 1)).toBe(before);
    expect(moveWithinContainer(before, "title", -1)).toBe(before);
  });

  it("places a field among its siblings, built-in fields not counted", () => {
    expect(placeAmongSiblings(fields(), "title")).toEqual({
      position: 1,
      of: 3,
    });
    expect(placeAmongSiblings(fields(), "b")).toEqual({ position: 2, of: 3 });
  });
});

describe("what a drag says", () => {
  const active = (id: string) => ({ id }) as unknown as Active;
  const over = (id: string) => ({ id }) as unknown as Over;

  it("says a refused drop moved nothing", () => {
    const say = builderAnnouncements(fields()).onDragEnd;
    expect(say({ active: active("title"), over: over("a") })).toBe(
      "Title cannot move there. Nothing moved."
    );
  });

  it("names the field and its place on an accepted drop", () => {
    const say = builderAnnouncements(fields()).onDragEnd;
    expect(say({ active: active("a"), over: over("c") })).toContain("A");
  });
});
