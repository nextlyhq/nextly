/**
 * What a panel control writes, as its tooltip and "Show CSS names" say it.
 */
import { describe, expect, it } from "vitest";

import {
  planFullWidth,
  planHeight,
  FULL_SCREEN,
  SIZES,
} from "./block-shortcuts";
import {
  BUILT_IN_WRITES,
  declarationsText,
  FULL_WIDTH_WRITES,
  heightShortcutWrites,
  leafWrites,
  propWrites,
  sizeShortcutWrites,
  tagWrites,
} from "./code-hints";

const leaf = { kind: "cssValue", cssProperty: "min-height", tokenKinds: [] };

describe("what a control writes", () => {
  it("joins declarations as a developer writes them", () => {
    expect(
      declarationsText([
        { property: "flex-direction", value: "column" },
        { property: "gap" },
      ])
    ).toBe("flex-direction: column; gap");
  });

  it("says a catalog control's property with the value it holds", () => {
    expect(leafWrites(leaf as never, "40px", "--site-")).toBe(
      "min-height: 40px"
    );
    expect(leafWrites(leaf as never, 3, "--site-")).toBe("min-height: 3");
    // And the property alone while it holds nothing.
    expect(leafWrites(leaf as never, undefined, "--site-")).toBe("min-height");
  });

  it("writes a site variable as the page's stylesheet names it", () => {
    expect(
      leafWrites(leaf as never, { $token: "space.section-y" }, "--brand-")
    ).toBe("min-height: var(--brand-space-section-y)");
    expect(
      leafWrites(leaf as never, { $token: "space.4", times: 2 }, "--site-")
    ).toBe("min-height: calc(var(--site-space-4) * 2)");
  });

  it("reads a block setting's code hint, one string or one per option", () => {
    expect(propWrites({ code: 'class="x"' })).toBe('class="x"');
    expect(
      propWrites({ code: { section: "<section>", div: "<div>" } }, "section")
    ).toBe("<section>");
    expect(propWrites({ code: { div: "<div>" } }, "main")).toBeUndefined();
    expect(propWrites({})).toBeUndefined();
  });

  it("names the builder's own Advanced rows and an HTML tag", () => {
    expect(BUILT_IN_WRITES).toEqual({
      anchor: "id",
      cssClasses: "class",
      searchPreviews: "data-nosnippet",
    });
    expect(tagWrites("section")).toBe("<section>");
  });
});

describe("what the block shortcuts write", () => {
  it("says the Height choices as the shortcut writes them", () => {
    expect(heightShortcutWrites(FULL_SCREEN)).toEqual({
      auto: "min-height: auto",
      screen: "min-height: 100svh",
    });
    // The control: the shortcut itself writes that value.
    const node = {
      id: "s",
      type: "core/section",
      version: 1,
      props: {},
    } as never;
    expect(
      JSON.stringify(
        planHeight(node, "screen", { state: "base", breakpoint: "base" })
      )
    ).toContain(`"minHeight":"${FULL_SCREEN}"`);
  });

  it("says the Size and Full width choices", () => {
    expect(sizeShortcutWrites(SIZES)).toEqual({
      small: "padding: calc(<padding> * 0.75); font-size: 0.875em",
      medium: "padding; font-size",
      large: "padding: calc(<padding> * 1.25); font-size: 1.125em",
    });
    expect(FULL_WIDTH_WRITES).toBe("width: 100%");
    const node = {
      id: "b",
      type: "core/button",
      version: 1,
      props: {},
    } as never;
    expect(
      JSON.stringify(
        planFullWidth(node, true, { state: "base", breakpoint: "base" })
      )
    ).toContain('"width":"100%"');
  });
});
