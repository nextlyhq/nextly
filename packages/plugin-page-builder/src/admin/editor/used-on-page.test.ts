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
  type NamedClass,
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
  tokens: [
    ...["primary", "accent", "muted", "border"].map(name => ({
      name: `color.${name}`,
      kind: "color" as const,
      values: { light: "#000000" },
    })),
    {
      name: "shadow.lift",
      kind: "shadow",
      values: { light: "0 1px 2px var(--site-color-accent)" },
    },
  ],
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
      [
        ...usedOnPage(
          [{ document: page, components: components }],
          DEFAULT_LIMITS,
          TOKENS
        ),
      ].sort()
    ).toEqual(["color.accent", "color.muted", "color.primary"]);
  });

  it("reads the shared styles and block looks its blocks wear", () => {
    const page = document([
      { ...coloured("p1", "#111111"), classes: ["c-card"] },
    ]);
    const library: NamedClass[] = [
      {
        id: "c-card",
        slug: "card",
        label: "Card",
        orderIndex: 0,
        styles: { base: { base: { color: { $token: "color.border" } } } },
      },
    ];
    expect([
      ...usedOnPage(
        [{ document: page, components: new Map() }],
        DEFAULT_LIMITS,
        TOKENS,
        library
      ),
    ]).toEqual(["color.border"]);
  });

  it("reads the site's own look for a block type the page draws, and not for one it does not", () => {
    const look = (blockType: string, colour: string): NamedClass => ({
      id: `l-${blockType}`,
      slug: `look-${blockType.replace("/", "-")}`,
      label: "Own look",
      orderIndex: 0,
      blockType,
      isDefault: true,
      styles: { base: { base: { color: { $token: colour } } } },
    });
    const page = document([coloured("p1", "#111111")]);
    expect([
      ...usedOnPage(
        [{ document: page, components: new Map() }],
        DEFAULT_LIMITS,
        TOKENS,
        [look("core/text", "color.primary"), look("core/image", "color.muted")]
      ),
    ]).toEqual(["color.primary"]);
  });

  it("reads the colour a variable it uses names through var()", () => {
    const page = document([
      {
        id: "p1",
        type: "core/box",
        version: 1,
        props: {},
        styles: { base: { base: { boxShadow: { $token: "shadow.lift" } } } },
      },
    ]);
    expect(
      [
        ...usedOnPage(
          [{ document: page, components: new Map() }],
          DEFAULT_LIMITS,
          TOKENS
        ),
      ].sort()
    ).toEqual(["color.accent", "shadow.lift"]);
  });

  it("reads the colours the site's text gives every page", () => {
    const site: SiteTokenSet = {
      ...TOKENS,
      siteText: {
        link: { color: { $token: "color.primary" } },
        caption: { color: "var(--site-color-muted)" },
      },
    };
    expect(
      [
        ...usedOnPage(
          [
            {
              document: document([coloured("p1", "#111111")]),
              components: new Map(),
            },
          ],
          DEFAULT_LIMITS,
          site
        ),
      ].sort()
    ).toEqual(["color.muted", "color.primary"]);
  });

  it("reads a component placed under a condition, which a visitor may see", () => {
    const components = new Map<string, BlockDocument>([
      [
        "card",
        document([coloured("c1", { $token: "color.accent" })], "component"),
      ],
    ]);
    const page = document([
      {
        ...placed("p1", "card"),
        visibility: {
          conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
        },
      } as BlockNode,
    ]);
    expect([
      ...usedOnPage(
        [{ document: page, components: components }],
        DEFAULT_LIMITS,
        TOKENS
      ),
    ]).toEqual(["color.accent"]);
  });

  it("reads the page's header and footer, each with its own components", () => {
    const header = document([placed("h1", "brand")]);
    const own = new Map<string, BlockDocument>([
      [
        "brand",
        document([coloured("b1", { $token: "color.border" })], "component"),
      ],
    ]);
    expect([
      ...usedOnPage(
        [
          { document: document([]), components: new Map() },
          { document: header, components: own },
        ],
        DEFAULT_LIMITS,
        TOKENS
      ),
    ]).toEqual(["color.border"]);
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
        [{ document: document([placed("p1", "loop")]), components }],
        DEFAULT_LIMITS,
        TOKENS
      ),
    ]).toEqual(["color.border"]);
  });
});
