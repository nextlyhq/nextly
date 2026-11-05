import {
  blockLooks,
  compilePageCss,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

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
    expect(looks.map(look => [look.blockType, look.slug, look.label])).toEqual([
      ["core/button", "button-secondary", "Secondary"],
      ["core/button", "button-outline", "Outline"],
      ["core/button", "button-text", "Text"],
      ["core/image", "image-rounded", "Rounded"],
      ["core/image", "image-circle", "Circle"],
      ["core/section", "section-hero", "Hero"],
    ]);
  });

  it("each name the block's own look", () => {
    const own = [button, image, section].map(
      definition =>
        definition.editor?.variations?.find(each => each.isDefault)?.label
    );
    expect(own).toEqual(["Primary", "Square", "Plain"]);
  });

  it.each(looks.map(look => [look.slug, look] as const))(
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
      expect(css).toContain(`.nx-c-${look.slug} {`);
    }
  );
});
