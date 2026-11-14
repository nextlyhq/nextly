/**
 * Where a field sits among its siblings, as a sentence says it, and what the
 * drag context says itself. Which moves are allowed is the move rule's, tested
 * with it (`__tests__/move-rule.test.ts`); what a drop on a row did, the
 * outline says, from the rule's answer.
 *
 * @module lib/builder/builder-rows.test
 */

import type { Active, Over } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderAnnouncements } from "./builder-announcements";
import { placeAmongSiblings } from "./builder-rows";

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

describe("a field's place", () => {
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

  it("leaves a drop on a row to the outline, which judges it", () => {
    const say = builderAnnouncements(fields()).onDragEnd;
    expect(say({ active: active("title"), over: over("a") })).toBeUndefined();
    expect(say({ active: active("a"), over: over("c") })).toBeUndefined();
  });

  it("says a drop over nothing moved nothing", () => {
    const say = builderAnnouncements(fields()).onDragEnd;
    expect(say({ active: active("title"), over: null })).toBe(
      "Title was dropped. Nothing moved."
    );
  });
});
