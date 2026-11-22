/**
 * What a block style's ⋯ menu offers, from what the style is: the site's
 * own, built-in, or the block's own style.
 */
import { describe, expect, it } from "vitest";

import { blockStyleOffers, offersAny } from "./block-style-row-menu";

const kind = (over: Partial<Parameters<typeof blockStyleOffers>[0]>) => ({
  own: false,
  builtIn: false,
  starred: false,
  hidden: false,
  ...over,
});

describe("what a block style's menu offers", () => {
  it("lets the site edit, rename, duplicate and remove its own style, never hide it", () => {
    expect(blockStyleOffers(kind({}), false)).toEqual({
      edit: true,
      setDefault: true,
      rename: true,
      duplicate: true,
      hide: undefined,
      remove: true,
    });
  });

  it("lets a built-in style be edited, duplicated and hidden, never renamed or removed", () => {
    expect(blockStyleOffers(kind({ builtIn: true }), false)).toEqual({
      edit: true,
      setDefault: true,
      rename: false,
      duplicate: true,
      hide: "hide",
      remove: false,
    });
    expect(
      blockStyleOffers(kind({ builtIn: true, hidden: true }), false).hide
    ).toBe("show");
  });

  it("offers the block's own style editing and ★ back, and nothing else", () => {
    expect(blockStyleOffers(kind({ own: true, builtIn: true }), false)).toEqual(
      {
        edit: true,
        setDefault: true,
        rename: false,
        duplicate: false,
        hide: undefined,
        remove: false,
      }
    );
  });

  it("doesn't offer ★ to the style that already carries it", () => {
    expect(blockStyleOffers(kind({ starred: true }), false).setDefault).toBe(
      false
    );
  });

  it("offers nothing while read-only", () => {
    const none = blockStyleOffers(kind({}), true);
    expect(offersAny(none)).toBe(false);
    // The control: a writable one offers something.
    expect(offersAny(blockStyleOffers(kind({}), false))).toBe(true);
  });
});
