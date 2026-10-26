/**
 * Which cards set to a collection a reader may be shown: a card naming a
 * collection they may not read is withheld whether or not that collection
 * exists, judged by the card's effective setting, its declared default
 * included.
 */
import { describe, expect, it } from "vitest";

import {
  collectionDefaultForReader,
  collectionSettingsToken,
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

  it('is shown when its value names no collection, as a special default such as "*" does', () => {
    // 🔴 The card's query reads "*" as naming no collection and reads its
    // widget's own source, so withholding it would hide a card that reads
    // nothing the reader may not.
    const everything = unreadableCollectionCard(
      collectionWidgets([
        {
          id: "acme/all",
          collectionSetting: { ...pinnedSetting, defaultValue: "*" },
        },
      ]),
      new Set(["posts"])
    );
    expect(everything(card("acme/all"))).toBe(false);
    expect(everything(card("acme/all", { source: "*" }))).toBe(false);
    // The must-differ half: a slug the reader may not read is still withheld.
    expect(everything(card("acme/all", { source: "secret" }))).toBe(true);
  });

  it("is shown when set to no collection, and for a widget with no Collection setting", () => {
    expect(withheld(card("core/count"))).toBe(false);
    expect(withheld(card("core/team", { collection: "secret" }))).toBe(false);
  });
});

describe("the Collection settings as scope-token inputs", () => {
  const token = (setting: AnyWidgetSetting) =>
    collectionSettingsToken([
      { id: "acme/pinned", collectionSetting: setting },
      { id: "core/team" },
    ]);

  it("has one entry per widget with a Collection setting", () => {
    expect(token(pinnedSetting)).toHaveLength(1);
  });

  it("changes when the setting is renamed, its default unchanged", () => {
    // 🔴 A card storing `{ collection: "secret" }` is withheld while the
    // setting is called `collection`, and shown once it is called `source`
    // with a readable default: a snapshot taken before must be refused, or its
    // save drops the card it never held.
    expect(token({ ...pinnedSetting, name: "collection" })).not.toEqual(
      token(pinnedSetting)
    );
  });

  it("changes when the default changes", () => {
    expect(token({ ...pinnedSetting, defaultValue: "posts" })).not.toEqual(
      token(pinnedSetting)
    );
  });

  it("is the same for the same declaration", () => {
    expect(token({ ...pinnedSetting })).toEqual(token(pinnedSetting));
  });
});

describe("a declaration as a reader is told it", () => {
  const limit: AnyWidgetSetting = {
    name: "limit",
    type: "number",
    defaultValue: 5,
  };
  const declaration = (setting: AnyWidgetSetting) => ({
    id: "acme/pinned",
    settings: [setting, limit],
  });

  it("withholds a Collection setting's default naming a collection the reader may not read", () => {
    // 🔴 Shipped as declared, the slug tells the reader of a collection they
    // may not read, whether or not they hold a card.
    const told = collectionDefaultForReader(
      declaration(pinnedSetting),
      new Set(["posts"])
    );
    expect(told.settings).toEqual([
      { name: "source", type: "collection", label: "Collection" },
      limit,
    ]);
    expect(JSON.stringify(told)).not.toContain("secret");
  });

  it("ships the same declaration when its default names a collection the reader may read", () => {
    // The must-differ half: the same declaration, for a reader who may read it.
    const whole = declaration(pinnedSetting);
    expect(collectionDefaultForReader(whole, new Set(["secret"]))).toBe(whole);
  });

  it("keeps a default that names no collection, and a declaration with no Collection setting", () => {
    const everything = declaration({ ...pinnedSetting, defaultValue: "*" });
    expect(collectionDefaultForReader(everything, new Set())).toBe(everything);
    const plain = { id: "core/team", settings: [limit] };
    expect(collectionDefaultForReader(plain, new Set())).toBe(plain);
    const bare: { id: string; settings?: readonly AnyWidgetSetting[] } = {
      id: "core/note",
    };
    expect(collectionDefaultForReader(bare, new Set())).toBe(bare);
  });
});
