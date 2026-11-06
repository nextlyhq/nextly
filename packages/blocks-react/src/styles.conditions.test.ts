/**
 * The stylesheet of a page whose conditioned blocks were decided by its
 * entry: a block kept because its conditions held brings its rules, and a
 * block a list's item decides brings none to the page's sheet, since only a
 * list drawing an item that shows it may serve them.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";
import { itemDecidedRules, resolvePageStyles } from "./styles";

const resolver = createBlockResolver([...coreBlocks]);
const context = {
  breakpoints: { viewport: [{ id: "base", label: "Base" }], container: [] },
} as never;

const coloured = (id: string, colour: string, conditions?: unknown) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  styles: { base: { base: { color: colour } } },
  ...(conditions === undefined ? {} : { visibility: { conditions } }),
});

const doc = (...nodes: unknown[]): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  }) as BlockDocument;

const vip = [[{ field: "tier", op: "equals", value: "vip" }]];

describe("the sheet of a page decided by its entry", () => {
  it("brings back the rules of a block kept because its conditions held", () => {
    // The tree as drawn: the held block is in it, so its rules are served.
    const styles = resolvePageStyles(
      doc(coloured("held", "#c01234", vip)),
      undefined,
      context,
      resolver
    );
    expect(styles.css).toContain("#c01234");
  });

  it("keeps a block a list's item decides out of the page's sheet, and names its rules for the list", () => {
    const list = {
      id: "l",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: { children: [coloured("perItem", "#c05678", vip)] },
    };
    const document = doc(list, coloured("plain", "#c09abc"));
    const styles = resolvePageStyles(document, undefined, context, resolver);
    // CONTROL: an unconditioned block's rules are in the sheet.
    expect(styles.css).toContain("#c09abc");
    expect(styles.css).not.toContain("#c05678");
    expect(
      itemDecidedRules(styles, document, () => false).get("perItem")
    ).toContain("#c05678");
  });

  it("gives a nested conditioned block its own rules, apart from the block around it", () => {
    const list = {
      id: "l",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: {
        children: [
          {
            ...coloured("outer", "#c01111", vip),
            type: "core/box",
            slots: {
              children: [
                coloured("nested", "#c02222", vip),
                coloured("inside", "#c03333"),
              ],
            },
          },
        ],
      },
    };
    const document = doc(list);
    const styles = resolvePageStyles(document, undefined, context, resolver);
    const rules = itemDecidedRules(styles, document, () => false);
    // The block around it carries its own rules and those of what it always
    // draws, not those of a block whose own conditions decide it.
    expect(rules.get("outer")).toContain("#c01111");
    expect(rules.get("outer")).toContain("#c03333");
    expect(rules.get("outer")).not.toContain("#c02222");
    expect(rules.get("nested")).toContain("#c02222");
  });

  it("leaves out the rules of a block inside it that draws nothing", () => {
    const list = {
      id: "l",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: {
        children: [
          {
            ...coloured("outer", "#c04444", vip),
            type: "core/box",
            slots: {
              children: [
                coloured("drawless", "#c05555"),
                coloured("drawn", "#c06666"),
              ],
            },
          },
        ],
      },
    };
    const document = doc(list);
    const styles = resolvePageStyles(document, undefined, context, resolver);
    const rules = itemDecidedRules(
      styles,
      document,
      node => node.id === "drawless"
    );
    // CONTROL: its drawn sibling's rules travel with the block around them.
    expect(rules.get("outer")).toContain("#c06666");
    expect(rules.get("outer")).not.toContain("#c05555");
  });
});
