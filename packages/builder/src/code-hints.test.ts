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
  controlWrites,
  propWrites,
  sizeShortcutWrites,
  tagWrites,
} from "./code-hints";

describe("what a control writes", () => {
  it("joins declarations as a developer writes them", () => {
    expect(
      declarationsText([
        { property: "flex-direction", value: "column" },
        { property: "gap" },
      ])
    ).toBe("flex-direction: column; gap");
  });

  const control = (property: string, path: string[], cssProperty: string) => ({
    property,
    path,
    leaf: { cssProperty },
  });

  it("says a catalog control's property with the value it holds", () => {
    const minHeight = control("minHeight", [], "min-height");
    expect(controlWrites(minHeight, "40px", "--site-")).toBe(
      "min-height: 40px"
    );
    // And the property alone while it holds nothing.
    expect(controlWrites(minHeight, undefined, "--site-")).toBe("min-height");
  });

  it("says a side of a property at its own path", () => {
    expect(
      controlWrites(
        control("padding", ["blockStart"], "padding-block-start"),
        "12px",
        "--site-"
      )
    ).toBe("padding-block-start: 12px");
  });

  it("writes a site variable as the page's stylesheet names it", () => {
    const minHeight = control("minHeight", [], "min-height");
    expect(
      controlWrites(minHeight, { $token: "space.section-y" }, "--brand-")
    ).toBe("min-height: var(--brand-space-section-y)");
    expect(
      controlWrites(minHeight, { $token: "space.4", times: 2 }, "--site-")
    ).toBe("min-height: calc(var(--site-space-4) * 2)");
  });

  it("writes an image as the page does: wrapped in url()", () => {
    const written = controlWrites(
      control("background", ["url"], "background-image"),
      "/hero.jpg",
      "--site-"
    );
    // With the overlay's layer in front, as the page's stylesheet writes it.
    expect(written).toMatch(/^background-image: /);
    expect(written).toContain('url("/hero.jpg")');
    expect(written).not.toBe("background-image: /hero.jpg");
  });

  it("writes a keyword the engine expands as every declaration it becomes", () => {
    const written = controlWrites(
      control("disclosureIcon", [], "--nx-disclosure-icon"),
      "plus",
      "--site-"
    );
    // More than the one property a naive reading would say.
    expect(written.split("; ").length).toBeGreaterThan(1);
  });

  it("says the animation an entrance effect writes, on hover", () => {
    const written = controlWrites(
      control("appear", ["effect"], "--nx-pb-appear-effect"),
      "rise",
      "--site-"
    );
    expect(written).toMatch(/^--nx-pb-appear-effect: rise; /);
    expect(written).toContain("animation-name: ");
    expect(written).toContain(
      "animation-duration: calc(var(--nx-pb-appear-duration, 600) * 1ms)"
    );
    expect(written).toContain("animation-timeline: ");
    expect(
      controlWrites(
        control("appear", ["start"], "--nx-pb-appear-start"),
        "load",
        "--site-"
      )
    ).toContain("--nx-pb-appear-timeline: auto");
  });

  it("falls back to the property alone for a value the engine refuses", () => {
    expect(
      controlWrites(control("minHeight", [], "min-height"), "red", "--site-")
    ).toBe("min-height");
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
