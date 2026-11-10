/**
 * Which part's draft each of a document's keys belongs to (`partKeysOf`).
 *
 * An unnamed group only arranges the form: its children are stored at the
 * level it sits in, so each one is a key of the document and belongs to a part
 * as any top-level field does. Classifying only named top-level fields would
 * leave those keys in neither draft, and a held edit to one would be lost.
 */
import { describe, expect, it } from "vitest";

import { partKeysOf } from "../part-drafts";

describe("partKeysOf", () => {
  it("classifies the fields of an unnamed group into their parts", async () => {
    const details = {
      type: "group",
      fields: [
        { type: "number", name: "rank" },
        { type: "text", name: "caption" },
      ],
    };
    const keys = await partKeysOf([{ type: "text", name: "title" }, details]);

    expect([...keys.language].sort()).toEqual(["caption", "title"]);
    expect([...keys.shared]).toEqual(["rank"]);
  });

  it("keeps a named group as one key of its own", async () => {
    const meta = {
      type: "group",
      name: "meta",
      fields: [{ type: "text", name: "caption" }],
    };
    const keys = await partKeysOf([{ type: "number", name: "views" }, meta]);

    // The group's value is one stored key; its children are not top-level.
    expect([...keys.language, ...keys.shared].sort()).toEqual([
      "meta",
      "views",
    ]);
  });

  // Every component is kept per language under the setting, wherever it sits:
  // a named group or repeater stores its children under its own key, so a
  // component inside one makes that key the language's.
  it("gives a language the key of a named container that holds a component", async () => {
    const layout = {
      type: "group",
      name: "layout",
      fields: [{ type: "component", name: "hero", component: "hero" }],
    };
    const items = {
      type: "repeater",
      name: "items",
      fields: [
        {
          type: "group",
          name: "inner",
          fields: [{ type: "component", name: "cta", component: "cta" }],
        },
      ],
    };
    const stats = {
      type: "group",
      name: "stats",
      fields: [{ type: "number", name: "views" }],
    };
    const keys = await partKeysOf([layout, items, stats]);

    expect([...keys.language].sort()).toEqual(["items", "layout"]);
    // The control: a container with no component stays where it was.
    expect([...keys.shared]).toEqual(["stats"]);
  });
});
