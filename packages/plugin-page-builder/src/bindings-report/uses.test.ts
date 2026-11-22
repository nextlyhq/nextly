/**
 * Where a stored blocks value binds a Single: every well-formed binding to
 * one, on a block at any depth or in the document's search details, and
 * nothing else.
 */
import { describe, expect, it } from "vitest";

import { bindingUsesOf } from "./uses";

const single = (sourceKey: string, path: string) => ({
  $bind: path,
  source: "single",
  sourceKey,
});

describe("bindingUsesOf", () => {
  it("lists a block's bindings to a Single at any depth, with its own name", () => {
    const uses = bindingUsesOf(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "section",
            type: "core/section",
            version: 1,
            props: {},
            slots: {
              children: [
                {
                  id: "cta",
                  type: "core/button",
                  version: 1,
                  name: "  Call to action ",
                  props: {},
                  bindings: {
                    label: single("homepage", "cta.label"),
                    href: { $bind: "slug" },
                  },
                },
              ],
            },
          },
        ],
      },
      100
    );
    expect(uses).toEqual([
      {
        nodeId: "cta",
        blockType: "core/button",
        blockName: "Call to action",
        prop: "label",
        sourceKey: "homepage",
        path: "cta.label",
      },
    ]);
  });

  it("lists the document's search details' bindings to a Single, without a block", () => {
    const uses = bindingUsesOf(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [],
        settings: {
          seo: {
            title: ["Welcome to ", single("homepage", "headline")],
            image: single("brand", "logo"),
          },
        },
      },
      100
    );
    expect(uses.map(use => [use.nodeId, use.prop, use.sourceKey])).toEqual([
      ["", "seo.title", "homepage"],
      ["", "seo.image", "brand"],
    ]);
  });

  it("leaves out bindings that name no Single or no field, and values that are no document", () => {
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "headline", source: "single" },
            level: { $bind: "", source: "single", sourceKey: "homepage" },
            title: { $bind: "title", source: "entry" },
          },
        },
      ],
    };
    expect(bindingUsesOf(page, 100)).toEqual([]);
    expect(bindingUsesOf("not a document", 100)).toEqual([]);
    expect(bindingUsesOf(null, 100)).toEqual([]);
  });

  it("reads a value stored as JSON text", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: {},
          bindings: { text: single("homepage", "headline") },
        },
      ],
    });
    expect(bindingUsesOf(text, 100)).toHaveLength(1);
  });

  it("walks no further than the node cap", () => {
    const nodes = Array.from({ length: 5 }, (_, index) => ({
      id: `h${String(index)}`,
      type: "core/heading",
      version: 1,
      props: {},
      bindings: { text: single("homepage", "headline") },
    }));
    const uses = bindingUsesOf({ formatVersion: 1, kind: "page", nodes }, 2);
    expect(uses.length).toBeLessThanOrEqual(2);
  });
});
