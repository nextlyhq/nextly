import {
  blockLooks,
  compilePageCss,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { sharedStyleInputsId } from "../shared-style-inputs";

import { button } from "./button";
import { image } from "./image";
import { section } from "./section";

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

describe("the looks the core blocks ship with", () => {
  const looks = blockLooks([button, image, section]);

  it("are the seeds the site receives, each bound to its block type", () => {
    expect(
      looks.map(look => [
        look.blockType,
        look.slug,
        look.label,
        look.isDefault === true,
      ])
    ).toEqual([
      // Each block's own look first, with no edits: where a site's edits to
      // the block's base are stored.
      ["core/button", "button-primary", "Primary", true],
      ["core/button", "button-secondary", "Secondary", false],
      ["core/button", "button-outline", "Outline", false],
      ["core/button", "button-text", "Text", false],
      ["core/image", "image-square", "Square", true],
      ["core/image", "image-rounded", "Rounded", false],
      ["core/image", "image-circle", "Circle", false],
      ["core/section", "section-plain", "Plain", true],
      ["core/section", "section-hero", "Hero", false],
    ]);
    expect(
      looks.filter(look => look.isDefault).map(look => look.styles)
    ).toEqual([{}, {}, {}]);
  });

  it("each name the block's own look", () => {
    const own = [button, image, section].map(
      definition =>
        definition.editor?.variations?.find(each => each.isDefault)?.label
    );
    expect(own).toEqual(["Primary", "Square", "Plain"]);
  });

  // The looks a block wears; an own look is never written as a class.
  const worn = looks.filter(look => look.isDefault !== true);
  it.each(worn.map(look => [look.slug, look] as const))(
    "%s compiles with no warning, on the block it belongs to",
    (_slug, look) => {
      const document = {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: look.blockType,
            version: 1,
            props: {},
            classes: [look.id],
          },
        ],
      } as unknown as BlockDocument;
      const { css, warnings } = compilePageCss(document, {
        breakpoints: BREAKPOINTS,
        namedClasses: [look],
      });
      expect(warnings).toEqual([]);
      // The population: the look's rule is written.
      expect(css).toContain(`.nx-l-${look.slug} {`);
    }
  );
});

describe("a look's binding in a stored sheet's stamp", () => {
  it("moves the stamp, and a class with no binding stamps as before", () => {
    const base = { breakpoints: BREAKPOINTS };
    const plain = { id: "c-x", slug: "x", orderIndex: 0, styles: {} };
    const bound = { ...plain, blockType: "core/button" };
    expect(sharedStyleInputsId({ ...base, namedClasses: [bound] })).not.toBe(
      sharedStyleInputsId({ ...base, namedClasses: [plain] })
    );
  });
});

describe("the stamp over a library at the cap", () => {
  it("moves when a look past the 2,000 shared styles changes", () => {
    const shared = Array.from({ length: 2000 }, (_, index) => ({
      id: `c-${index}`,
      slug: `s${index}`,
      orderIndex: index,
      styles: {},
    }));
    const look = (color: string) => ({
      id: "look:core/button:outline",
      slug: "button-outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: { base: { base: { color } } } as never,
    });
    const id = (color: string) =>
      sharedStyleInputsId({
        breakpoints: BREAKPOINTS,
        namedClasses: [...shared, look(color)],
      });
    expect(id("red")).not.toBe(id("blue"));
  });
});
