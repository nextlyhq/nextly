/**
 * The variables the open page uses, for the Colours tab's "Used on this
 * page": its own blocks, the components it places at any depth, and a
 * colour read through `var()`, by the walk the usage index uses.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { usedOnPage } from "./used-on-page";

const coloured = (id: string, colour: unknown): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  styles: { base: { base: { color: colour } } },
});

const placed = (id: string, componentId: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const document = (
  nodes: BlockNode[],
  kind: "page" | "component" = "page"
): BlockDocument => ({ formatVersion: DOCUMENT_FORMAT_VERSION, kind, nodes });

const TOKENS: SiteTokenSet = {
  tokens: ["primary", "accent", "muted", "border"].map(name => ({
    name: `color.${name}`,
    kind: "color" as const,
    values: { light: "#000000" },
  })),
};

describe("the variables the open page uses", () => {
  it("reads its blocks, the components it places at any depth, and var() of a colour", () => {
    const components = new Map<string, BlockDocument>([
      [
        "card",
        document(
          [coloured("c1", { $token: "color.accent" }), placed("c2", "badge")],
          "component"
        ),
      ],
      [
        "badge",
        document([coloured("b1", "var(--site-color-muted)")], "component"),
      ],
    ]);
    const page = document([
      coloured("p1", { $token: "color.primary" }),
      placed("p2", "card"),
    ]);
    expect(
      [...usedOnPage(page, components, DEFAULT_LIMITS, TOKENS)].sort()
    ).toEqual(["color.accent", "color.muted", "color.primary"]);
  });

  it("reads a component placed inside itself once", () => {
    const components = new Map<string, BlockDocument>([
      [
        "loop",
        document(
          [coloured("l1", { $token: "color.border" }), placed("l2", "loop")],
          "component"
        ),
      ],
    ]);
    expect([
      ...usedOnPage(
        document([placed("p1", "loop")]),
        components,
        DEFAULT_LIMITS,
        TOKENS
      ),
    ]).toEqual(["color.border"]);
  });
});
