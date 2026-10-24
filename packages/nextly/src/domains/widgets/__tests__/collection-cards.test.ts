/**
 * Which cards set to a collection a reader may be shown: a card naming a
 * collection they may not read is withheld, a card whose collection is gone is
 * not, and an unanswered registry read never hands one over.
 */
import { describe, expect, it } from "vitest";

import {
  collectionSettingNames,
  unreadableCollectionCard,
} from "../collection-cards";
import type { WidgetPlacement } from "../layout";

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

const names = collectionSettingNames([
  {
    id: "core/count",
    settings: [
      { name: "collection", type: "collection" },
      { name: "filter", type: "filter" },
    ],
  },
  { id: "core/notes", settings: [{ name: "text", type: "textarea" }] },
  { id: "core/team" },
]);

describe("the Collection setting each widget declares", () => {
  it("names it for a widget that has one, and for no other", () => {
    expect([...names]).toEqual([["core/count", "collection"]]);
  });
});

describe("a card set to a collection, for one reader", () => {
  const withheld = unreadableCollectionCard(
    names,
    new Set(["posts"]),
    new Set(["posts", "secret"])
  );

  it("is shown when the reader may read its collection", () => {
    expect(withheld(card("core/count", { collection: "posts" }))).toBe(false);
  });

  it("is withheld when its collection exists and the reader may not read it", () => {
    // 🔴 Handed over, its settings would name the collection.
    expect(withheld(card("core/count", { collection: "secret" }))).toBe(true);
  });

  it("is shown when its collection no longer exists, so it draws not available", () => {
    expect(withheld(card("core/count", { collection: "gone" }))).toBe(false);
  });

  it("is shown when it is set to no collection, and for a widget with no Collection setting", () => {
    expect(withheld(card("core/count"))).toBe(false);
    expect(withheld(card("core/count", { collection: 7 }))).toBe(false);
    expect(withheld(card("core/team", { collection: "secret" }))).toBe(false);
  });

  it("is withheld for any collection outside the readable ones while the registry is unread", () => {
    const unread = unreadableCollectionCard(
      names,
      new Set(["posts"]),
      undefined
    );
    expect(unread(card("core/count", { collection: "gone" }))).toBe(true);
    expect(unread(card("core/count", { collection: "posts" }))).toBe(false);
  });
});
