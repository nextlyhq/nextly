/**
 * The demo site's welcome page, checked before any seed writes it.
 *
 * The seed stores these documents through the page builder's own field rules,
 * so a document the engine refuses would fail a contributor's first
 * `pnpm dev:app` rather than a test. This holds each one to the engine's
 * strict validation, and holds the welcome page to what it exists to show: a
 * pattern's copy, placements that set only what the card exposes, and a
 * Layout header that is locked.
 */
import { describe, expect, it } from "vitest";

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  validateDocument,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
} from "@nextlyhq/blocks-engine";

import {
  featureCardDocument,
  heroPatternDocument,
  siteFooterDocument,
  siteHeaderDocument,
  welcomePageDocument,
} from "../../seed/composition-demo";
import { SITE_STYLE_DEFAULTS } from "../../src/lib/site-style-defaults";

interface Definition {
  name: string;
  parent?: readonly string[];
  props?: Record<string, unknown>;
  slots?: Record<string, { allow?: readonly string[] } | undefined>;
}

/** The block a placement is stored as, which the page builder registers. */
const INSTANCE = "nextly/component-instance";

const DEFINITIONS = coreBlocks as unknown as Definition[];
const BY_NAME = new Map(DEFINITIONS.map(block => [block.name, block]));

const NESTING: NestingSource = {
  parentsOf: type => BY_NAME.get(type)?.parent,
  slotAllowOf: (parentType, slot) =>
    (BY_NAME.get(parentType)?.slots?.[slot] as { allow?: readonly string[] })
      ?.allow,
};

function walk(nodes: readonly BlockNode[]): BlockNode[] {
  return nodes.flatMap(node => [
    node,
    ...Object.values(node.slots ?? {}).flatMap(children =>
      walk(children ?? [])
    ),
  ]);
}

function errorsOf(document: BlockDocument): string[] {
  return validateDocument(document, {
    mode: "strict",
    breakpoints: SITE_STYLE_DEFAULTS.breakpoints,
    registry: { has: type => BY_NAME.has(type) || type === INSTANCE },
    nesting: NESTING,
  })
    .issues.filter(issue => issue.severity === "error")
    .map(issue => `${issue.path}: ${issue.code} — ${issue.message}`);
}

const HERO = heroPatternDocument("media-1");
const CARD = featureCardDocument();
const WELCOME = welcomePageDocument(
  { id: "pattern-1", document: HERO },
  "card-1"
);

const DOCUMENTS: ReadonlyArray<readonly [string, BlockDocument]> = [
  ["the header", siteHeaderDocument()],
  ["the footer", siteFooterDocument()],
  ["the feature card", CARD],
  ["the hero pattern", HERO],
  ["the welcome page", WELCOME],
];

describe("the demo site's documents", () => {
  it.each(DOCUMENTS)(
    "%s is one the engine accepts, in strict mode",
    (_, doc) => {
      expect(walk(doc.nodes).length).toBeGreaterThan(0);
      expect(errorsOf(doc)).toEqual([]);
    }
  );

  it("REPORTS a document the engine would refuse", () => {
    // The control for the case above, which passes by finding nothing: two
    // nodes sharing an id, as a pattern placed twice without fresh ids would.
    const twice: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [...HERO.nodes, ...HERO.nodes],
    };
    expect(errorsOf(twice)).not.toEqual([]);
  });

  it.each(DOCUMENTS)("%s writes only props its blocks declare", (_, doc) => {
    const undeclared = walk(doc.nodes).flatMap(node => {
      const declared = BY_NAME.get(node.type)?.props;
      if (declared === undefined) return [];
      return Object.keys(node.props).filter(
        prop => !Object.hasOwn(declared, prop)
      );
    });
    expect(undeclared).toEqual([]);
  });

  it.each(DOCUMENTS)("%s names a token for every colour", (_, doc) => {
    // A literal colour would hold its light value on a dark page.
    const literal = walk(doc.nodes).flatMap(node =>
      Object.values(node.styles ?? {}).flatMap(states =>
        Object.values(states ?? {}).flatMap(set =>
          Object.entries((set ?? {}) as Record<string, unknown>)
            .filter(([property]) => /colou?r$/i.test(property))
            .filter(
              ([, value]) =>
                value !== "transparent" &&
                !(
                  typeof value === "object" &&
                  value !== null &&
                  "$token" in value
                )
            )
            .map(([property]) => `${node.id}.${property}`)
        )
      )
    );
    expect(literal).toEqual([]);
  });
});

describe("the welcome page", () => {
  const nodes = walk(WELCOME.nodes);

  it("starts with its own copy of the hero pattern, under fresh ids", () => {
    const hero = WELCOME.nodes[0];
    expect(hero?.type).toBe("core/section");
    expect(hero?.origin).toMatchObject({ from: "pattern", id: "pattern-1" });
    const patternIds = new Set(walk(HERO.nodes).map(node => node.id));
    const copied = walk([hero]).map(node => node.id);
    expect(copied).toHaveLength(patternIds.size);
    expect(copied.filter(id => patternIds.has(id))).toEqual([]);
  });

  it("places the feature card three times, each setting only what it exposes", () => {
    const exposed = new Set((CARD.exposed ?? []).map(field => field.id));
    const placements = nodes.filter(node => node.type === INSTANCE);
    expect(placements).toHaveLength(3);
    for (const placement of placements) {
      expect(placement.props.componentId).toBe("card-1");
      const keys = Object.keys(placement.props.overrides as object);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter(key => !exposed.has(key))).toEqual([]);
    }
  });

  it("draws inside a header whose blocks carry the Layers lock", () => {
    expect(siteHeaderDocument().nodes.map(node => node.locked)).toEqual([true]);
  });
});
