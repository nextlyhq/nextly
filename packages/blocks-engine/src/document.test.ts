import { describe, expect, it } from "vitest";

import type { BlockDocument } from "./document";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  isComponentInstance,
  isTokenRef,
} from "./document";
import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  LIMIT_WARNING_RATIO,
  MAX_DEPTH,
  MAX_NODES,
  documentBytes,
} from "./limits";
import { makeNode } from "./tree";

describe("document constants", () => {
  it("pins the format version and the closed kind enum", () => {
    expect(DOCUMENT_FORMAT_VERSION).toBe(1);
    expect(DOCUMENT_KINDS).toEqual([
      "page",
      "pattern",
      "component",
      "region",
      "template",
    ]);
  });

  it("pins the limits the format spec documents", () => {
    expect(MAX_DEPTH).toBe(12);
    expect(MAX_NODES).toBe(5000);
    expect(DEFAULT_MAX_DOCUMENT_BYTES).toBe(2 * 1024 * 1024);
    expect(LIMIT_WARNING_RATIO).toBe(0.8);
  });
});

describe("guards", () => {
  it("isTokenRef accepts only { $token: string }", () => {
    expect(isTokenRef({ $token: "color.primary" })).toBe(true);
    expect(isTokenRef({ token: "color.primary" })).toBe(false);
    expect(isTokenRef("var(--x)")).toBe(false);
    expect(isTokenRef(null)).toBe(false);
    expect(isTokenRef({ $token: 3 })).toBe(false);
  });

  it("isComponentInstance keys on the reserved node type", () => {
    const instance = makeNode(COMPONENT_INSTANCE_TYPE, 1, {
      componentId: "cmp-1",
    });
    expect(isComponentInstance(instance)).toBe(true);
    expect(isComponentInstance(makeNode("core/heading", 1))).toBe(false);
  });
});

describe("JSON round-trip", () => {
  it("a full document survives serialize → parse structurally unchanged", () => {
    // Exercises every envelope feature at once: bindings, styles on both
    // states, breakpoint-keyed values, token refs, visibility, slots.
    const doc: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          ...makeNode(
            "core/section",
            2,
            {},
            {
              children: [
                {
                  ...makeNode("core/heading", 1, { text: "Fallback title" }),
                  bindings: {
                    text: {
                      $bind: "title",
                      source: "entry",
                      fallback: "Untitled",
                      format: { type: "date", options: { dateStyle: "long" } },
                    },
                  },
                  styles: {
                    base: { base: { color: { $token: "color.text" } } },
                    hover: { base: { color: "#ff0000" } },
                  },
                  visibility: {
                    conditions: [[{ field: "status", op: "eq", value: "vip" }]],
                    devices: { mobile: false },
                  },
                  name: "Hero heading",
                },
              ],
            }
          ),
          classes: ["cls_hero"],
          locked: true,
        },
      ],
      settings: { customCss: ".page { scroll-behavior: smooth; }" },
      assets: { mediaIds: ["media-1"] },
    };

    const parsed = JSON.parse(JSON.stringify(doc)) as BlockDocument;
    expect(parsed).toEqual(doc);
    expect(documentBytes(doc)).toBeGreaterThan(0);
    expect(documentBytes(doc)).toBeLessThan(DEFAULT_MAX_DOCUMENT_BYTES);
  });

  it("documentBytes measures UTF-8 bytes, not string length", () => {
    const ascii: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [makeNode("core/text", 1, { text: "aaaa" })],
    };
    const cjk: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [makeNode("core/text", 1, { text: "字字字字" })],
    };
    // Same JSON string length per character, but CJK is 3 UTF-8 bytes each.
    expect(documentBytes(cjk)).toBeGreaterThan(documentBytes(ascii));
  });
});
