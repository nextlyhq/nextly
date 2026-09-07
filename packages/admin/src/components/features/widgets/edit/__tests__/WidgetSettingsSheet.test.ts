/**
 * What the settings form opens with, and what it stores.
 *
 * The two functions the sheet's correctness rests on, tested apart from the
 * rendering: what a reader SEES when they open the panel, and what is written
 * when they save. Both are pure, and both encode a decision the component
 * cannot express on its own.
 */
import { describe, expect, it } from "vitest";

import { initialValues, toStoredConfig } from "../WidgetSettingsSheet";
import type { WidgetSetting } from "nextly/config";

const limit: WidgetSetting = { name: "limit", type: "number", defaultValue: 5 };
const title: WidgetSetting = { name: "title", type: "text" };

describe("what the form opens with", () => {
  it("shows the stored answer when there is one", () => {
    expect(initialValues([limit], { limit: 12 })).toEqual({ limit: 12 });
  });

  /*
   * 🔴 Built from the DECLARATION, not from the stored config. A setting the
   * reader has never touched opens at its default rather than blank — the form
   * shows what the card is actually using, which is what
   * `resolveWidgetSettings` decides on the read side.
   */
  it("shows the declared default for an untouched setting", () => {
    expect(initialValues([limit], undefined)).toEqual({ limit: 5 });
  });

  it("does not show a stored key the declaration no longer knows", () => {
    // A ghost field for a setting the widget dropped would be uneditable and
    // unexplainable.
    const values = initialValues([limit], { limit: 3, gone: "x" });
    expect(values).toEqual({ limit: 3 });
  });

  it("opens a setting with no default and no answer as empty", () => {
    expect(initialValues([title], undefined)).toEqual({ title: "" });
  });
});

/*
 * 🔴 A setting NAME is chosen by a plugin, and on an ordinary object
 * `__proto__` is not data. Written, it invokes the prototype setter and the
 * value never lands; read, it answers `Object.prototype` rather than
 * `undefined`. Both halves are exercised, because they fail in opposite
 * directions: the form opened blank, and the save wrote the prototype object
 * to storage for a field nobody filled in.
 */
describe("a setting named __proto__ is data, both ways", () => {
  const odd: WidgetSetting = {
    name: "__proto__",
    type: "text",
    defaultValue: "d",
  };

  it("opens at its stored value rather than blank", () => {
    const config = JSON.parse('{"__proto__":"stored"}') as Record<
      string,
      unknown
    >;
    const values = initialValues([odd], config);
    expect(Object.keys(values)).toEqual(["__proto__"]);
    expect(values["__proto__"]).toBe("stored");
  });

  it("stores what the reader typed, and nothing when they typed nothing", () => {
    // 🔴 Built through `JSON.parse`, not an object literal. In literal syntax
    // `{ __proto__: x }` is the PROTOTYPE SETTER and creates no own property,
    // so a fixture written that way tests nothing -- the same trap the code
    // under test exists to survive.
    const typed = JSON.parse('{"__proto__":"typed"}') as Record<
      string,
      unknown
    >;
    expect(toStoredConfig([odd], typed, undefined)["__proto__"]).toBe("typed");

    // The other direction: an ordinary form object that never carried this key
    // answers `Object.prototype` when indexed, which is neither `undefined`
    // nor `""` and so reached storage.
    expect(Object.keys(toStoredConfig([odd], {}, undefined))).toEqual([]);
  });
});

describe("what is stored on save", () => {
  /*
   * 🔴 A value equal to its declared default is DROPPED. The stored config is
   * the reader's departure from the author's intent, so writing the default
   * back would pin today's default forever — the card would stop following a
   * later change to it, silently, and only for readers who opened the panel.
   */
  it("does not store a value that equals the declared default", () => {
    expect(toStoredConfig([limit], { limit: 5 }, undefined)).toEqual({});
  });

  it("stores a value that departs from the default", () => {
    expect(toStoredConfig([limit], { limit: 12 }, undefined)).toEqual({
      limit: 12,
    });
  });

  it("drops an emptied field rather than storing a blank", () => {
    expect(toStoredConfig([title], { title: "" }, undefined)).toEqual({});
  });

  it("ignores a value for something the widget does not declare", () => {
    expect(
      toStoredConfig([limit], { limit: 12, stray: "x" }, undefined)
    ).toEqual({
      limit: 12,
    });
  });

  /*
   * 🔴 A stored key the declaration does not know SURVIVES the save. The
   * reading layer keeps such a key deliberately -- a plugin that renames a
   * setting or is uninstalled must not cost a reader the values they chose,
   * because reinstalling it restores them. This form is built from the
   * DECLARATION and never sees those keys, so rebuilding the config from it
   * alone discarded exactly what the reader was promised: opening the panel and
   * pressing Save was enough to lose them.
   */
  it("carries a stored key the declaration no longer knows", () => {
    expect(
      toStoredConfig([limit], { limit: 12 }, { legacy: "kept", limit: 3 })
    ).toEqual({ legacy: "kept", limit: 12 });
  });

  it("still lets the form clear a key the declaration DOES know", () => {
    // The other half. Carrying the old config must not resurrect a value the
    // reader just emptied, which is what a plain merge would do.
    expect(
      toStoredConfig([title], { title: "" }, { title: "old", legacy: "kept" })
    ).toEqual({ legacy: "kept" });
  });
});
