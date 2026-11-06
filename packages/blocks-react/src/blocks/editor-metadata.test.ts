/**
 * Every core block carries the metadata the palette reads.
 *
 * A documented convention with nothing enforcing it is not a control, and this
 * one had already been broken by the whole library: nineteen blocks shipped
 * with no `editor` at all, so the inserter grouped them under a single "other"
 * heading and showed each block's namespaced identity as its name. Nothing
 * failed, because none of it is required by the type.
 *
 * These are also the example every plugin author copies. A first-party library
 * that omits the three fields teaches the ecosystem that they are optional.
 *
 * @module blocks/editor-metadata.test
 */
import { describe, expect, it } from "vitest";

import { BLOCK_ICONS } from "@nextlyhq/blocks-engine";

import { CORE_CATEGORIES } from "./categories";
import { coreBlocks } from "./index";

describe("core block editor metadata", () => {
  it("reads a populated library", () => {
    // The population, before any verdict. Every assertion below is `.each` over
    // this list, and an empty list satisfies all of them by having nothing to
    // contradict — a suite that silently stopped discovering blocks would read
    // as a clean pass.
    expect(coreBlocks.length).toBeGreaterThan(15);
    expect(coreBlocks.map(block => block.name)).toContain("core/heading");
    expect(coreBlocks.map(block => block.name)).toContain(
      "core/collection-loop"
    );
  });

  it.each(coreBlocks.map(block => [block.name, block] as const))(
    "%s declares a label, a category and keywords",
    (name, block) => {
      const editor = block.editor;
      expect(editor).toBeDefined();

      // A label the author reads, not the identity. The inserter humanises a
      // missing one, which is a guess rather than a name someone chose.
      expect(typeof editor?.label).toBe("string");
      expect(editor?.label?.length ?? 0).toBeGreaterThan(0);
      expect(editor?.label).not.toBe(name);

      // Membership in the declared set rather than "is a string": a category is
      // a free string, so "Interactive" and "interactive" would become two
      // headings in the palette with no error anywhere.
      expect(CORE_CATEGORIES).toContain(editor?.category);

      // Keywords are the field nobody notices is missing. Without them a search
      // matches only the label and the description, so a reader looking for
      // "picture" finds nothing and reads it as an empty library.
      expect(Array.isArray(editor?.keywords)).toBe(true);
      expect(editor?.keywords?.length ?? 0).toBeGreaterThan(0);
      for (const keyword of editor?.keywords ?? []) {
        expect(typeof keyword).toBe("string");
        expect(keyword).toBe(keyword.toLowerCase());
      }
    }
  );

  it.each(coreBlocks.map(block => [block.name, block] as const))(
    "%s names an icon from the vocabulary",
    (_name, block) => {
      const icon = block.editor?.icon;

      // Membership rather than "is a string", for the same reason the category
      // is checked that way and a stronger one: the type admits any string so a
      // plugin can name a concept a newer engine added, which means a typo in a
      // FIRST-PARTY block is accepted by the compiler and draws the generic
      // mark. The palette then looks correct and says nothing.
      expect(BLOCK_ICONS as readonly string[]).toContain(icon);
    }
  );

  it("describes every block in one plain line an author reads", () => {
    // Shown in the Add panel's popover and the block card: one sentence in an
    // author's words. How a block works belongs in its code comments, not
    // here, and an internal name ("core/column") never reaches an author.
    const problems = coreBlocks.flatMap(block => {
      const text = block.description;
      const wrong: string[] = [];
      if (text.length > 70) wrong.push("over 70 characters");
      if (!text.endsWith(".")) wrong.push("does not end a sentence");
      if (/\.\s+\S/.test(text)) wrong.push("more than one sentence");
      if (/core\//.test(text)) wrong.push("names an internal block");
      return wrong.map(reason => `${block.name}: ${reason}`);
    });
    expect(problems).toEqual([]);
  });

  it("gives every block a distinct label", () => {
    // Two blocks reading the same in the palette is indistinguishable to an
    // author, and a per-block check cannot see it: each label is individually
    // valid. Only comparing the set does.
    const labels = coreBlocks.map(block => block.editor?.label);
    expect(new Set(labels).size).toBe(coreBlocks.length);
  });

  it("uses every declared category, so none is dead", () => {
    // The other direction. A category nothing claims is a heading the palette
    // can never draw, which is the same drift as a block naming one that does
    // not exist — caught here rather than by reading the two lists side by side.
    const claimed = new Set(coreBlocks.map(block => block.editor?.category));
    for (const category of CORE_CATEGORIES) {
      expect(claimed).toContain(category);
    }
  });
});

describe("where a link opens, as its choices read", () => {
  it("says This tab and New tab, short enough to share one line", () => {
    // "A new tab" wrapped onto two lines in the inspector's segmented control.
    for (const name of ["core/button", "core/heading"]) {
      const block = coreBlocks.find(each => each.name === name);
      const target = (
        block?.props as Record<string, { optionLabels?: unknown }>
      ).target;
      expect(target?.optionLabels).toEqual({
        _self: "This tab",
        _blank: "New tab",
      });
    }
  });
});

describe("a container's HTML tag", () => {
  it("is named HTML tag, each tag in words with the tag itself shown", () => {
    // "Element type" over raw tags read as code.
    const containers = coreBlocks.filter(block => {
      const as = (block.props as Record<string, { type?: string } | undefined>)
        .as;
      return as?.type === "select";
    });
    expect(containers.length).toBeGreaterThanOrEqual(7);
    for (const block of containers) {
      const as = (
        block.props as Record<
          string,
          {
            label?: string;
            options?: string[];
            optionLabels?: Record<string, string>;
            showOptionValue?: boolean;
          }
        >
      ).as;
      expect(as?.label).toBe("HTML tag");
      expect(as?.showOptionValue).toBe(true);
      for (const tag of as?.options ?? []) {
        expect(as?.optionLabels?.[tag], `${block.name}: ${tag}`).toBeDefined();
      }
    }
  });
});

describe("a button's Acts as", () => {
  it("is offered only without a link, to a URL or to an entry", () => {
    const button = coreBlocks.find(block => block.name === "core/button");
    const type = (button?.props as Record<string, Record<string, unknown>>)
      .type;
    expect(type?.label).toBe("Acts as");
    expect(type?.onlyWithout).toEqual(["href", ["entryCollection", "entryId"]]);
  });
});
