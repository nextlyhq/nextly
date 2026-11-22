/**
 * Registration refuses a block setting placed where it cannot be right, and
 * says which block and which setting. The engine's rule for where a setting
 * is edited, with its defaults, is pinned beside it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { propPlace, STYLE_SECTION_KEYS, type PropSchema } from "./block";
import { clearBlocks, registerBlocks } from "./registry";

afterEach(() => clearBlocks());

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** A block with one setting, declared as `schema`. */
function withSetting(schema: Record<string, unknown>) {
  return { ...base, name: "acme/card", props: { setting: schema } };
}

function register(schema: Record<string, unknown>): void {
  registerBlocks([withSetting(schema)] as never, { source: "acme" });
}

describe("a setting's place at registration", () => {
  it("accepts every tab, with a Style section for a style setting", () => {
    // The positive control: a gate refusing every placement would pass the
    // refusals below while making a hint impossible to declare.
    for (const schema of [
      { type: "select", group: "content", section: "Link" },
      { type: "boolean", group: "advanced" },
      { type: "boolean", group: "style", section: "layout" },
      { type: "select", group: "style", section: "size" },
      // No hint at all: Content, as every block declared before.
      { type: "text" },
      // What the block says, in Content.
      { type: "text", role: "content", group: "content" },
    ]) {
      expect(() => register(schema), JSON.stringify(schema)).not.toThrow();
      clearBlocks();
    }
  });

  it("refuses a tab that does not exist, naming the block and the setting", () => {
    for (const group of ["Style", "settings", 1, null]) {
      expect(() => register({ type: "boolean", group })).toThrow(
        /block "acme\/card" setting "setting" names the tab .* which is not one of content, style or advanced/
      );
      clearBlocks();
    }
  });

  it("refuses what the block says anywhere but Content", () => {
    for (const group of ["style", "advanced"]) {
      expect(() =>
        register({ type: "select", role: "content", group, section: "size" })
      ).toThrow(
        new RegExp(
          `block "acme/card" setting "setting" is what the block says \\(role "content"\\), so it belongs in the content tab, not ${group}`
        )
      );
      clearBlocks();
    }
  });

  it("refuses text, media, an address, a relation or a list in Style, per type", () => {
    for (const type of [
      "text",
      "textarea",
      "richText",
      "media",
      "upload",
      "url",
      "relation",
      "entryField",
      "array",
    ]) {
      expect(() =>
        register({ type, group: "style", section: "layout" })
      ).toThrow(
        new RegExp(
          `block "acme/card" setting "setting" holds ${type} content, which belongs in the content tab, not style`
        )
      );
      clearBlocks();
    }
  });

  it("refuses a style setting whose section is not a Style section", () => {
    for (const section of [undefined, "Layout", "Link", "sizing"]) {
      expect(() =>
        register({ type: "boolean", group: "style", section })
      ).toThrow(
        /block "acme\/card" setting "setting" is in the style tab, so its section must be one of icon, layout, spacing/
      );
      clearBlocks();
    }
  });

  it("refuses a section that is not words", () => {
    expect(() => register({ type: "boolean", section: 4 })).toThrow(
      /block "acme\/card" setting "setting" names its section with something other than words/
    );
  });
});

describe("where a setting is edited", () => {
  const schema = (extra: Partial<PropSchema>): PropSchema => ({
    type: "boolean",
    ...extra,
  });

  it("is Content, in a section named after the block, by default", () => {
    expect(propPlace(schema({}), "Card")).toEqual({
      tab: "content",
      section: "Card",
    });
  });

  it("is the tab and section the setting declares", () => {
    expect(propPlace(schema({ section: "Link" }), "Card")).toEqual({
      tab: "content",
      section: "Link",
    });
    expect(propPlace(schema({ group: "advanced" }), "Card")).toEqual({
      tab: "advanced",
      section: "HTML",
    });
    expect(
      propPlace(schema({ group: "advanced", section: "Behaviour" }), "Card")
    ).toEqual({ tab: "advanced", section: "Behaviour" });
    expect(
      propPlace(schema({ group: "style", section: "layout" }), "Card")
    ).toEqual({ tab: "style", section: "layout" });
  });

  it("lists the Style sections a style setting can name", () => {
    expect(STYLE_SECTION_KEYS).toEqual([
      "icon",
      "layout",
      "spacing",
      "size",
      "position",
      "typography",
      "background",
      "border",
      "effects",
    ]);
  });
});
