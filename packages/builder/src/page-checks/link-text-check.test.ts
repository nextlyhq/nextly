/**
 * The link text check: a link or button with no words, or with only vague
 * ones ("click here", "read more"), and a linked icon with no label. Called
 * over stored documents with no DOM.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { LINK_TEXT_CHECK } from "./link-text-check";
import { runPageChecks } from "./page-checks";

function block(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props, ...extra };
}

const button = (id: string, props: Record<string, unknown>, extra = {}) =>
  block(id, "core/button", { type: "button", ...props }, extra);

/** A rich text block holding one link with these words. */
function richLink(id: string, words: string): BlockNode {
  return block(id, "core/rich-text", {
    content: {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Our story. " },
              {
                type: "link",
                url: "/about",
                children: words === "" ? [] : [{ type: "text", text: words }],
              },
            ],
          },
        ],
      },
    },
  });
}

function findings(...nodes: BlockNode[]) {
  const document: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  return runPageChecks({ document }, [LINK_TEXT_CHECK]).findings;
}

describe("the link text check", () => {
  it("passes buttons and links that say where they go", () => {
    expect(
      findings(
        button("a", { label: "Book a call", href: "/book" }),
        richLink("r", "about our team")
      )
    ).toEqual([]);
  });

  it("flags a button with no text, opening its Label", () => {
    expect(findings(button("a", { label: "  " }))).toEqual([
      expect.objectContaining({
        group: "accessibility",
        nodeId: "a",
        what: "Button has no text",
        fix: { tab: "content", id: "label" },
      }),
    ]);
  });

  it("takes a screen reader label in place of the words", () => {
    expect(
      findings(button("a", { label: "", ariaLabel: "Open the menu" }))
    ).toEqual([]);
    expect(
      findings(
        button("b", {
          label: "Read more",
          ariaLabel: "Read more about pricing",
        })
      )
    ).toEqual([]);
  });

  it("leaves a button whose words are bound to a field", () => {
    expect(
      findings(
        button(
          "a",
          { label: "" },
          {
            bindings: { label: { source: "entry", path: "title" } as never },
          }
        )
      )
    ).toEqual([]);
  });

  it.each(["Click here", "read more", "Learn more…", "HERE", "More"])(
    "flags a button that only says %j",
    words => {
      expect(findings(button("a", { label: words, href: "/x" }))).toEqual([
        expect.objectContaining({
          nodeId: "a",
          what: "Button text doesn’t say where it goes",
          fix: { tab: "content", id: "label" },
        }),
      ]);
    }
  );

  it("flags a linked icon with no label, opening its label", () => {
    expect(
      findings(
        block("i", "core/icon", {
          icon: "lucide:menu",
          label: "",
          href: "/menu",
        })
      )
    ).toEqual([
      expect.objectContaining({
        nodeId: "i",
        what: "Icon button has no label",
        fix: { tab: "content", id: "label" },
      }),
    ]);
  });

  it("leaves an icon that links nowhere, or has a label", () => {
    expect(
      findings(
        block("i", "core/icon", { icon: "lucide:star", label: "" }),
        block("j", "core/icon", {
          icon: "lucide:menu",
          label: "Menu",
          href: "/m",
        }),
        block("k", "core/icon", {
          icon: "lucide:menu",
          label: "",
          entryCollection: "pages",
          entryId: "p-1",
        })
      )
    ).toEqual([
      expect.objectContaining({
        nodeId: "k",
        what: "Icon button has no label",
      }),
    ]);
  });

  it("flags a link in rich text with no words, or only vague ones", () => {
    expect(findings(richLink("r", ""), richLink("s", "click here"))).toEqual([
      expect.objectContaining({ nodeId: "r", what: "Link has no text" }),
      expect.objectContaining({
        nodeId: "s",
        what: "Link text doesn’t say where it goes: “click here”",
      }),
    ]);
  });

  it("flags a button in rich text, alone or in a group, with only vague words", () => {
    const passage = (children: unknown[]) =>
      block("r", "core/rich-text", {
        content: { root: { type: "root", children } },
      });
    expect(
      findings(
        passage([
          { type: "button-link", url: "/a", text: "Read more" },
          {
            type: "button-group",
            buttons: [
              { url: "/b", text: "See pricing" },
              { url: "/c", text: "Click here" },
              // Not drawn: a button with no words.
              { url: "/d", text: "" },
            ],
          },
        ])
      )
    ).toEqual([
      expect.objectContaining({
        nodeId: "r",
        what: "Button text doesn’t say where it goes: “Read more”",
      }),
      expect.objectContaining({
        nodeId: "r",
        what: "Button text doesn’t say where it goes: “Click here”",
      }),
    ]);
  });

  it("flags a heading that links with only vague words", () => {
    expect(
      findings(
        block("h", "core/heading", {
          text: "Read more",
          level: "h2",
          href: "/x",
        })
      )
    ).toEqual([
      expect.objectContaining({
        nodeId: "h",
        what: "Link text doesn’t say where it goes: “Read more”",
        fix: { tab: "content", id: "text" },
      }),
    ]);
  });
});
