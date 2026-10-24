/**
 * Which cards set to a collection a reader may be shown: a card naming a
 * collection they may not read is withheld whether or not that collection
 * exists, judged by the card's effective setting, its declared default
 * included.
 */
import { describe, expect, it } from "vitest";

import {
  collectionWidgets,
  unreadableCollectionCard,
} from "../collection-cards";
import type { WidgetPlacement } from "../layout";
import type { AnyWidgetSetting } from "../settings";

const card = (
  widgetId: string,
  config?: Record<string, unknown>
): WidgetPlacement => ({
  id: "c",
  widgetId,
  width: "quarter",
  removed: false,
  ...(config === undefined ? {} : { config }),
});

const countSetting: AnyWidgetSetting = {
  name: "collection",
  type: "collection",
  label: "Collection",
};
const pinnedSetting: AnyWidgetSetting = {
  name: "source",
  type: "collection",
  label: "Collection",
  defaultValue: "secret",
};

// As the canonical summary carries them: the Collection setting, from either
// channel, and nothing for a widget without one.
const widgets = collectionWidgets([
  { id: "core/count", collectionSetting: countSetting },
  { id: "acme/pinned", collectionSetting: pinnedSetting },
  { id: "core/team" },
]);

describe("the widgets with a Collection setting", () => {
  it("holds each such widget with its setting, and no other widget", () => {
    expect([...widgets.keys()]).toEqual(["core/count", "acme/pinned"]);
    expect(widgets.get("acme/pinned")?.name).toBe("source");
  });
});

describe("a card set to a collection, for one reader", () => {
  const withheld = unreadableCollectionCard(widgets, new Set(["posts"]));

  it("is shown when the reader may read its collection", () => {
    expect(withheld(card("core/count", { collection: "posts" }))).toBe(false);
  });

  it("is withheld when the reader may not read its collection, whether it exists or not", () => {
    // 🔴 One answer for both: telling them apart tells the reader which names
    // exist.
    expect(withheld(card("core/count", { collection: "secret" }))).toBe(true);
    expect(withheld(card("core/count", { collection: "nowhere" }))).toBe(true);
  });

  it("is judged by its declared default when it stores no value", () => {
    expect(withheld(card("acme/pinned"))).toBe(true);
    expect(withheld(card("acme/pinned", { source: "posts" }))).toBe(false);
  });

  it("is shown when set to no collection, and for a widget with no Collection setting", () => {
    expect(withheld(card("core/count"))).toBe(false);
    expect(withheld(card("core/team", { collection: "secret" }))).toBe(false);
  });
});
