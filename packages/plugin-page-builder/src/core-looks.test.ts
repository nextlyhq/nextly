import { describe, expect, it } from "vitest";

import { withBlockLooks, withCoreLooks } from "./core-looks";
import { classOverrideOf } from "./site-style";

describe("the core blocks' looks in the site's code tier", () => {
  it("adds every core look as a class the code supplies", () => {
    const ids = (withCoreLooks(undefined).classes ?? []).map(each => each.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "look:core/button:outline",
        "look:core/image:circle",
        "look:core/section:hero",
      ])
    );
  });

  it("keeps the site config's own classes, and its own copy of a look", () => {
    const mine = {
      id: "look:core/button:outline",
      slug: "button-outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: { base: { base: { color: "black" } } },
    };
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    const classes = withCoreLooks({ classes: [mine, card] }).classes ?? [];
    expect(classes.filter(each => each.id === mine.id)).toEqual([mine]);
    expect(classes).toContainEqual(card);
  });

  it("stores a site's edit of a look as an override, which compares its block type", () => {
    const configured = withCoreLooks(undefined).classes ?? [];
    const outline = configured.find(
      each => each.id === "look:core/button:outline"
    );
    if (outline === undefined) throw new Error("no outline look");
    // The same look bound to another type is a different look.
    const moved = { ...outline, blockType: "core/text" };
    expect(classOverrideOf(configured, [moved])).toEqual([moved]);
    expect(classOverrideOf(configured, [outline])).toEqual([]);
  });
});

describe("looks of blocks another plugin declares", () => {
  it("join the code tier once their definitions are known", () => {
    const hero = {
      name: "acme/hero",
      editor: {
        variations: [
          {
            name: "dark",
            label: "Dark",
            styles: { base: { base: { color: "white" } } },
          },
        ],
      },
    };
    const ids = (withBlockLooks(undefined, [hero]).classes ?? []).map(
      each => each.id
    );
    expect(ids).toEqual(["look:acme/hero:dark"]);
  });
});
