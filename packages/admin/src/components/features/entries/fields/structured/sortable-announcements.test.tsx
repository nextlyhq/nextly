/**
 * What a drag says, and that every sortable surface can be driven by keyboard.
 *
 * The sentences are asserted by shape and by subject: they must name the thing
 * being moved, never its id, and they must say where it is in the words the
 * surface supplied. The sensors are asserted by membership, because a surface
 * that reaches for the pointer alone looks finished to anyone testing with a
 * mouse.
 *
 * @module components/features/entries/fields/structured/sortable-announcements.test
 */

import {
  KeyboardSensor,
  PointerSensor,
  type Active,
  type Over,
} from "@dnd-kit/core";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  positionInList,
  sortableAnnouncements,
  useSortableSensors,
  type AnnouncedItem,
} from "./field-array-helpers";

/**
 * The two ends of a drag as dnd-kit hands them to an announcement.
 *
 * The builder reads only the id and the data; the rects are the part no
 * sentence uses, and they are shaped differently on each end, which is why
 * there are two of these.
 */
function active(id: string, data: Record<string, unknown> = {}): Active {
  return {
    id,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  };
}
const NOWHERE = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
function over(id: string, data: Record<string, unknown> = {}): Over {
  return { id, data: { current: data }, rect: NOWHERE, disabled: false };
}

const ROWS = ["title", "slug", "body"];
const LABELS: Record<string, string> = {
  title: "Title",
  slug: "Slug",
  body: "Body",
};

const model = {
  describe: ({ id }: AnnouncedItem) => LABELS[String(id)],
  place: ({ id }: AnnouncedItem) => positionInList(ROWS, id),
};

describe("what a drag says", () => {
  const say = sortableAnnouncements(model);

  it("names the row and its position on pick-up", () => {
    expect(say.onDragStart({ active: active("title") })).toBe(
      "Picked up Title, position 1 of 3."
    );
  });

  it("names the row it is over, with the position a drop there would take", () => {
    expect(
      say.onDragOver({ active: active("title"), over: over("body") })
    ).toBe("Title is over Body, position 3 of 3.");
  });

  it("says nothing while the item is over itself", () => {
    // 🔴 The first hover dnd-kit reports after pick-up is the item over its own
    // slot. Spoken, "Slug is over Slug" replaces the pick-up sentence a beat
    // after it was said; unspoken, the pick-up stands until the item reaches
    // a different row.
    expect(
      say.onDragOver({ active: active("slug"), over: over("slug") })
    ).toBeUndefined();
  });

  it("says when it has left the list", () => {
    expect(say.onDragOver({ active: active("title"), over: null })).toBe(
      "Title is no longer over a list."
    );
  });

  it("names the landing by position", () => {
    expect(say.onDragEnd({ active: active("title"), over: over("slug") })).toBe(
      "Title moved to position 2 of 3."
    );
  });

  it("reports a drop back onto its own row as unchanged", () => {
    // 🔴 Space twice with no arrow, or a pointer released over the original
    // row: dnd-kit hands the item itself as `over`, every handler skips the
    // reorder, and "moved to position 2 of 3" confirmed a move that never
    // happened.
    expect(say.onDragEnd({ active: active("slug"), over: over("slug") })).toBe(
      "Slug was dropped where it was. Nothing moved."
    );
  });

  it("says nothing moved on a drop outside the list", () => {
    expect(say.onDragEnd({ active: active("title"), over: null })).toBe(
      "Title was dropped. Nothing moved."
    );
  });

  it("says where a cancelled drag went back to", () => {
    expect(say.onDragCancel({ active: active("slug"), over: null })).toBe(
      "Dragging cancelled. Slug returned to position 2 of 3."
    );
  });

  it("never reads an id aloud", () => {
    // 🔴 The defect this replaces. dnd-kit's defaults say "Picked up draggable
    // item <id>", and every id here is a field name, a placement id or a
    // uuid. An id the surface cannot name is called "the item" rather than
    // spoken.
    const unknown = active("3f9a2c1e-7b4d-4e0a-9c8f-1d2e3f4a5b6c");
    const heard = [
      say.onDragStart({ active: unknown }),
      say.onDragOver({ active: unknown, over: over("title") }),
      say.onDragEnd({ active: unknown, over: null }),
      say.onDragCancel({ active: unknown, over: null }),
    ].join(" ");
    expect(heard).not.toContain("3f9a2c1e");
    expect(heard).toContain("the item");
  });

  it("drops the place clause when the surface has none to give", () => {
    // A surface may know names and not positions -- a grid whose model is
    // columns, say. The sentence closes cleanly rather than trailing a comma.
    const nameOnly = sortableAnnouncements({ describe: model.describe });
    expect(nameOnly.onDragStart({ active: active("title") })).toBe(
      "Picked up Title."
    );
    expect(nameOnly.onDragCancel({ active: active("title"), over: null })).toBe(
      "Dragging cancelled. Title is where it was."
    );
    expect(
      nameOnly.onDragEnd({ active: active("title"), over: over("slug") })
    ).toBe("Title moved to Slug.");
  });
});

describe("where an id sits in a list", () => {
  it("is one-based, as a reader counts", () => {
    expect(positionInList(ROWS, "title")).toBe("position 1 of 3");
    expect(positionInList(ROWS, "body")).toBe("position 3 of 3");
  });

  it("is nothing for an id the list does not hold", () => {
    expect(positionInList(ROWS, "author")).toBeUndefined();
  });
});

describe("the sensors every sortable surface drags with", () => {
  it("include the keyboard, not only the pointer", () => {
    // 🔴 Two tables shipped with a pointer-only `useSensors` of their own,
    // and nobody testing with a mouse could tell. Asserted by membership,
    // because jsdom performs no layout and a keyboard move cannot be
    // observed by its effect here -- only by the sensor that would cause it.
    const { result } = renderHook(() => useSortableSensors());
    const kinds = result.current.map(descriptor => descriptor.sensor);
    expect(kinds).toContain(KeyboardSensor);
    expect(kinds).toContain(PointerSensor);
  });
});
