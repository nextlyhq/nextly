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
  isRawColour,
  validateDocument,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import {
  featureCardDocument,
  heroPatternDocument,
  seedCompositionDemo,
  siteFooterDocument,
  siteHeaderDocument,
  welcomePageDocument,
  type DemoStore,
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

/**
 * Properties whose value may carry a colour inside other text: a shadow, a
 * gradient, a filter. A colour is found in them by allowing none of them at
 * all, rather than by recognising every way CSS spells a colour.
 */
const COLOUR_BEARING = new Set([
  "boxShadow",
  "textShadow",
  "background",
  "backgroundGradient",
  "filter",
]);

/**
 * Every place in `nodes`' styles that holds a colour of its own rather than a
 * site token, as `<node id>.<property path>`. A colour property, at any depth
 * (a border's `color` included), is judged by the engine's own rule, the one
 * the editor marks "not adapted to dark mode" by. A literal colour would hold
 * its light value on a dark page.
 */
function rawColoursIn(nodes: readonly BlockNode[]): string[] {
  const found: string[] = [];
  const visit = (value: unknown, path: string, key: string): void => {
    if (COLOUR_BEARING.has(key)) {
      found.push(path);
      return;
    }
    if (/colou?r$/i.test(key)) {
      if (isRawColour(value as StyleValue)) found.push(path);
      return;
    }
    if (typeof value === "object" && value !== null && !("$token" in value)) {
      for (const [inner, next] of Object.entries(value)) {
        visit(next, `${path}.${inner}`, inner);
      }
    }
  };
  for (const node of walk(nodes)) {
    for (const states of Object.values(node.styles ?? {})) {
      for (const set of Object.values(states ?? {})) {
        for (const [property, value] of Object.entries(
          (set ?? {}) as Record<string, unknown>
        )) {
          visit(value, `${node.id}.${property}`, property);
        }
      }
    }
  }
  return found;
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
    expect(rawColoursIn(doc.nodes)).toEqual([]);
  });

  it("REPORTS a literal colour wherever a style holds one", () => {
    // The control for the case above, which passes by finding nothing.
    const styled = (set: Record<string, unknown>): BlockNode => ({
      id: Object.keys(set)[0] ?? "none",
      type: "core/box",
      version: 1,
      props: {},
      styles: { base: { base: set } } as BlockNode["styles"],
    });
    expect(
      rawColoursIn([
        styled({ color: "red" }),
        styled({ border: { color: "#000", style: "solid" } }),
        styled({ boxShadow: "0 0 4px red" }),
        styled({ textShadow: "0 1px hwb(0 0% 0%)" }),
        styled({ backgroundColor: { $token: "color.surface" } }),
      ])
    ).toEqual([
      "color.color",
      "border.border.color",
      "boxShadow.boxShadow",
      "textShadow.textShadow",
    ]);
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

/** A store holding rows by collection and slug, as the seeder sees one. */
function memoryStore(
  seeded: Record<string, Record<string, unknown>> = {},
  refuseOnce: ReadonlySet<string> = new Set()
) {
  const rows = new Map<string, Record<string, unknown>>(Object.entries(seeded));
  const refused = new Set<string>();
  const created: Array<{ collection: string; data: Record<string, unknown> }> =
    [];
  let next = 0;
  const store: DemoStore = {
    find: async ({ collection, where }) => {
      const row = rows.get(`${collection}/${where.slug.equals}`);
      return { items: row === undefined ? [] : [row] };
    },
    create: async ({ collection, data }) => {
      const key = `${collection}/${String(data.slug)}`;
      if (refuseOnce.has(key) && !refused.has(key)) {
        // Another seed run's row lands first, and this insert is refused.
        refused.add(key);
        rows.set(key, { id: `winner-${key}`, ...data });
        throw Object.assign(new Error("duplicate"), { code: "DUPLICATE" });
      }
      const row = { id: `id-${(next += 1)}`, ...data };
      rows.set(key, row);
      created.push({ collection, data });
      return { item: row };
    },
  };
  return { store, created, rows };
}

const noImage = { heroImage: async () => null };

describe("seeding the welcome page", () => {
  it("copies the hero from the stored pattern when the pattern is already there", async () => {
    const edited = {
      formatVersion: 1,
      kind: "pattern",
      nodes: [
        {
          id: "edited",
          type: "core/heading",
          version: 1,
          props: { text: "An edited hero", level: "h1" },
        },
      ],
    };
    const { store, created } = memoryStore({
      "patterns/demo-hero": { id: "stored-pattern", content: edited },
    });
    expect(await seedCompositionDemo(store, noImage)).toEqual({ created: 1 });

    const page = created.find(row => row.collection === "pages");
    if (page === undefined) throw new Error("no page was created");
    const nodes = walk((page.data.content as BlockDocument).nodes);
    expect(nodes[0]?.props.text).toBe("An edited hero");
    expect(nodes[0]?.origin).toMatchObject({ id: "stored-pattern" });
    expect(JSON.stringify(page.data.content)).not.toContain(
      "Build pages, not pipelines"
    );
  });

  it("uses the row another seed run made when its own insert is refused as a duplicate", async () => {
    const { store, rows } = memoryStore(
      {},
      new Set(["components/demo-site-header", "pages/welcome"])
    );
    expect(await seedCompositionDemo(store, noImage)).toEqual({ created: 0 });

    const layout = rows.get("layouts/demo-site") as {
      areas: { area: string; component: string }[];
    };
    expect(layout.areas).toContainEqual({
      area: "header",
      component: "winner-components/demo-site-header",
    });
  });

  it("leaves an existing welcome page and its parts alone", async () => {
    const { store, created } = memoryStore({
      "pages/welcome": { id: "kept" },
    });
    expect(await seedCompositionDemo(store, noImage)).toEqual({ created: 0 });
    expect(created).toEqual([]);
  });
});
