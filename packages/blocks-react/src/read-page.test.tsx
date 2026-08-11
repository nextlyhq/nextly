/**
 * What a stored stylesheet may still be trusted to describe.
 *
 * The pairing these tests exist for is easy to get wrong in BOTH directions, so
 * almost every case here comes with its opposite. Trusting too much ships rules
 * for markup that is gone; trusting too little blanks a working page's styling
 * on the happy path, with no error, which is the worse failure and the one a
 * test asserting only `css === ""` would happily certify.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type {
  AnyBlockDefinition,
  BlockDocument,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { defineBlock } from "./context";
import { preparePageForRead } from "./read-page";
import { createBlockResolver } from "./resolver";
import { resolvePageStyles } from "./styles";

/** A plugin block that declares it draws nothing for these props. */
const drawless = defineBlock<{ draw: boolean }>({
  name: "plugin/drawless",
  version: 1,
  description: "Draws only when told to.",
  example: { props: { draw: true } },
  defaultProps: { draw: false },
  rendersNothing: props => props.draw !== true,
  render: ({ props, className }) =>
    props.draw ? <p className={className}>drawn</p> : null,
});

const text = defineBlock<{ value: string }>({
  name: "test/text",
  version: 1,
  description: "Text.",
  example: { props: { value: "x" } },
  defaultProps: { value: "" },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

/** What the site had installed when the page was saved. */
const withPlugin = createBlockResolver([
  drawless as AnyBlockDefinition,
  text as AnyBlockDefinition,
]);
/** What the site has installed when the page is read: the plugin is gone. */
const withoutPlugin = createBlockResolver([text as AnyBlockDefinition]);

/**
 * A page whose only `plugin/drawless` node declares it draws nothing.
 *
 * That node is what makes the block-type tier and the named class appear in the
 * sheet, and it is the only thing on the page that justifies either.
 */
const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: "plugin/drawless",
      version: 1,
      props: { draw: false },
      classes: ["only-a"],
      styles: { base: { base: { color: "rebeccapurple" } } },
    },
    {
      id: "b",
      type: "test/text",
      version: 1,
      props: { value: "y" },
      styles: { base: { base: { color: "teal" } } },
    },
  ],
};

const context: StyleCompileContext = {
  blockBases: {
    "plugin/drawless": { base: { base: { letterSpacing: "3px" } } },
    "test/text": { base: { base: { fontSize: "16px" } } },
  },
  namedClasses: [
    {
      id: "only-a",
      slug: "only-a",
      orderIndex: 0,
      styles: { base: { base: { letterSpacing: "7px" } } },
    },
  ],
};

/** The artifact the write path stores for the page above. */
function storedSheet(): ReturnType<typeof resolvePageStyles> {
  return resolvePageStyles(document, undefined, context, withPlugin);
}

describe("a node that is both a placeholder and drawless", () => {
  it("does not leave the tiers it justified in a trusted sheet", () => {
    // The node's OWN rules were never the exposure: gating moved them into the
    // per-node map, and nothing appends them once the node is gone. What stays
    // is everything keyed by something OTHER than the node — the defaults for
    // its block type, and the named class only it referenced.
    const stored = storedSheet();
    expect(stored.css).toContain("nx-bt-plugin--drawless");
    expect(stored.css).toContain("nx-c-only-a");

    const read = preparePageForRead(document, {
      resolver: withoutPlugin,
      styles: stored,
    });

    expect(read.styles.css).not.toContain("nx-bt-plugin--drawless");
    expect(read.styles.css).not.toContain("nx-c-only-a");
  });

  it("CONTROL: keeps the same sheet while the plugin is installed", () => {
    // Without this, the case above passes on an implementation that withholds
    // every stored sheet unconditionally — which is the opposite defect and
    // costs every page its styling rather than one page some dead bytes.
    const read = preparePageForRead(document, {
      resolver: withPlugin,
      styles: storedSheet(),
    });

    expect(read.styles.css).toContain("nx-bt-plugin--drawless");
    expect(read.styles.css).toContain("nx-c-only-a");
    expect(read.styles.css).toContain("color: teal");
  });

  it("recompiles rather than withholding when it can", () => {
    // Withholding is the answer only when there is nothing to compile from. A
    // caller that supplied the inputs gets a sheet describing the tree that
    // survived: node b keeps its styling, and the departed node's tiers are gone
    // because nothing on the page pulls them in any more.
    const read = preparePageForRead(document, {
      resolver: withoutPlugin,
      styles: storedSheet(),
      styleContext: context,
    });

    expect(read.styles.css).toContain("color: teal");
    expect(read.styles.css).not.toContain("nx-bt-plugin--drawless");
  });
});

describe("what must NOT count as a repair", () => {
  it("keeps a stored sheet for a page nothing changed", () => {
    // Migration allocates a new document on every read, so a repair test that
    // compared it against the pass before would report every page ever read as
    // repaired and withhold every stored sheet on the happy path.
    const read = preparePageForRead(document, {
      resolver: withPlugin,
      styles: storedSheet(),
    });

    expect(read.styles.css).not.toBe("");
    expect(read.styles.css).toBe(storedSheet().css);
  });

  it("keeps a stored sheet for a page whose node is condition-gated away", () => {
    // The per-node map exists for exactly this: a conditioned node's rules
    // travel separately and are appended for the survivors, so its absence is
    // described rather than unaccounted. Treating gating as a repair would cost
    // every page carrying a conditioned block its whole stylesheet.
    const conditioned: BlockDocument = {
      ...document,
      nodes: [
        {
          id: "c",
          type: "test/text",
          version: 1,
          props: { value: "hidden" },
          styles: { base: { base: { color: "crimson" } } },
          visibility: { conditions: [{ kind: "never" }] },
        },
        ...document.nodes,
      ],
    };
    const stored = resolvePageStyles(
      conditioned,
      undefined,
      context,
      withPlugin
    );
    // The fixture has to REACH the gating pass for the rest to mean anything. A
    // condition the engine does not recognise leaves the node ungated, its rules
    // in the main sheet, and the assertions below satisfied by a page that never
    // gated anything.
    expect(stored.gated?.c).toContain("crimson");
    expect(stored.css).not.toContain("crimson");

    const read = preparePageForRead(conditioned, {
      resolver: withPlugin,
      styles: stored,
    });

    expect(read.styles.css).toContain("color: teal");
    expect(read.styles.css).not.toContain("crimson");
  });
});

describe("the reading view", () => {
  it("answers null for an envelope this build cannot speak", () => {
    const wrongVersion = {
      formatVersion: 99,
      kind: "page",
      nodes: [],
    } as unknown as BlockDocument;

    const read = preparePageForRead(wrongVersion, { resolver: withPlugin });

    expect(read.document).toBeNull();
    expect(read.styles.css).toBe("");
  });

  it("answers null for a page presenting nothing but placeholders", () => {
    const allPlaceholders: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [{ id: "a", type: "plugin/unregistered", version: 1, props: {} }],
    };

    const read = preparePageForRead(allPlaceholders, {
      resolver: withoutPlugin,
    });

    expect(read.document).toBeNull();
  });

  it("CONTROL: answers with the tree for a page that survives", () => {
    const read = preparePageForRead(document, { resolver: withPlugin });

    expect(read.document?.nodes.map(node => node.id)).toEqual(["a", "b"]);
  });
});
