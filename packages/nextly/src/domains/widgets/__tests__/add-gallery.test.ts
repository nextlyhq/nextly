/**
 * The add gallery's order, which needs no database: core's widgets in their own order, then the
 * site's, then each plugin's.
 */
import { describe, expect, it } from "vitest";

import { inGalleryOrder } from "../add-panel";
import type { CanonicalWidget } from "../canonical";
import { CORE_WIDGET_ID, CORE_WIDGET_IDS } from "../core-widgets/ids";

describe("inGalleryOrder", () => {
  it("lists core's add-only widgets first, then the site's, then each plugin's as they came", () => {
    const widgets: CanonicalWidget[] = [
      { id: "b/one", plugin: "b" },
      { id: "site/x" },
      { id: CORE_WIDGET_ID.teamActivity },
      { id: "a/one", plugin: "a" },
      { id: CORE_WIDGET_ID.count },
      { id: "b/two", plugin: "b" },
      { id: "site/y" },
    ];
    expect(inGalleryOrder(widgets).map(widget => widget.id)).toEqual([
      CORE_WIDGET_ID.count,
      CORE_WIDGET_ID.teamActivity,
      "site/x",
      "site/y",
      "b/one",
      "b/two",
      "a/one",
    ]);
  });

  it("lists every one of core's widgets once, the collection cards and the Note first, Setup last", () => {
    const listed = inGalleryOrder(
      [...CORE_WIDGET_IDS].reverse().map(id => ({ id }))
    ).map(widget => widget.id);
    expect([...listed].sort()).toEqual([...CORE_WIDGET_IDS].sort());
    expect(listed.slice(0, 5)).toEqual([
      CORE_WIDGET_ID.count,
      CORE_WIDGET_ID.recentEntries,
      CORE_WIDGET_ID.overTime,
      CORE_WIDGET_ID.breakdown,
      CORE_WIDGET_ID.note,
    ]);
    expect(listed.at(-1)).toBe(CORE_WIDGET_ID.setup);
  });
});
