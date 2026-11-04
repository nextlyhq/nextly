/**
 * Turning every copy of a component into plain blocks leaves the page looking
 * exactly the same.
 *
 * Each case renders a page through the published renderer, converts every
 * copy of the component with the engine, renders again, and compares the two
 * markups once DOM ids are set aside: the conversion keeps what a reader saw,
 * and only the link to the component goes.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  inlineComponentInstances,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { createStandaloneContext } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);
const anyParent = { parentsOf: () => undefined };
const noSlotLocks = { get: () => undefined };

/** Every media id resolves to its own address, so a lost id shows. */
const context = createStandaloneContext({
  resolveMedia: async (id: string) => ({ url: `/media/${id}.png`, alt: id }),
});

const block = (
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode => ({ id, type, version: 1, props, ...extra });

const box = (id: string, children: BlockNode[]): BlockNode =>
  block(id, "core/box", {}, { slots: { children } });

const placement = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
): BlockNode =>
  block(id, COMPONENT_INSTANCE_TYPE, { componentId, ...props }, extra);

const passage = (words: string) => ({
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", text: words, format: 1 }],
      },
    ],
  },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/**
 * A card exposing a heading, a passage and an image, with a variant and a
 * slot the page fills.
 */
const CARD = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    box("frame", [
      block("title", "core/heading", { text: "Default title", level: "h2" }),
      block("intro", "core/text", { text: "The card's own words" }),
      block("body", "core/rich-text", { content: passage("Default passage") }),
      block("photo", "core/image", { mediaId: "default-photo", alt: "" }),
      block(
        "anchored",
        "core/text",
        { text: "An anchored line" },
        { cssId: "card-anchor" }
      ),
      box("extra", [block("fallback", "core/text", { text: "Nothing given" })]),
    ]),
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "title",
      propPath: "text",
      type: "text",
    },
    {
      id: "intro",
      label: "Intro",
      nodeId: "intro",
      propPath: "text",
      type: "text",
    },
    {
      id: "body",
      label: "Body",
      nodeId: "body",
      propPath: "content",
      type: "richText",
    },
    {
      id: "photo",
      label: "Photo",
      nodeId: "photo",
      propPath: "mediaId",
      type: "image",
    },
  ],
  slots: { extra: { label: "Extra", nodeId: "extra", slot: "children" } },
  variants: {
    loud: {
      label: "Loud",
      overrides: { title: "LOUD TITLE", photo: "loud-photo" },
    },
  },
} as unknown as BlockDocument;

/** Another component, which the conversion must leave linked. */
const NOTE = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [block("note", "core/text", { text: "A linked note" })],
} as unknown as BlockDocument;

const DEFINITIONS: DefinitionsById = new Map([
  ["card", CARD],
  ["note", NOTE],
]);

async function markup(document: BlockDocument): Promise<string> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={blocks}
      context={context}
      definitions={DEFINITIONS}
    />
  );
  return new Response(stream).text();
}

/**
 * The markup with every DOM id, every reference to one, and every per-node
 * class replaced by its order of first appearance. These are the one
 * difference a conversion is allowed to make: a composed node's ids are
 * scoped to its placement, a converted node's are its own, and the per-node
 * class is derived from the node id.
 */
function normalised(html: string): string {
  const ids: string[] = [];
  const found = [
    ...html.matchAll(/\sid="([^"]+)"/g),
    ...html.matchAll(/\b(nx-pb-(?!page\b)[a-z0-9]+)\b/g),
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const match of found) {
    const id = match[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  // Longest first, so an id that contains another is replaced whole.
  const order = [...ids].sort((a, b) => b.length - a.length);
  let out = html;
  for (const id of order) out = out.split(id).join(`@id${ids.indexOf(id)}`);
  return out;
}

function converted(document: BlockDocument): BlockDocument {
  const result = inlineComponentInstances(
    document,
    "card",
    DEFINITIONS,
    anyParent,
    noSlotLocks
  );
  if (result.problem !== undefined) {
    throw new Error(`conversion refused: ${result.problem}`);
  }
  return result.document;
}

const CASES: { name: string; document: BlockDocument; shows: string }[] = [
  {
    name: "a copy with the component's own text, passage and image",
    document: page([
      block("before", "core/text", { text: "Before" }),
      placement("p", "card"),
    ]),
    shows: "Default passage",
  },
  {
    name: "a copy with its own text, passage and image",
    document: page([
      placement("p", "card", {
        overrides: {
          title: "This page's title",
          body: passage("This page's passage"),
          photo: "page-photo",
        },
      }),
    ]),
    shows: "page-photo",
  },
  {
    name: "a copy that clears an exposed value",
    document: page([
      placement("p", "card", { overrides: { intro: { $unset: true } } }),
    ]),
    shows: "Default title",
  },
  {
    name: "a copy on a variant",
    document: page([placement("p", "card", { variant: "loud" })]),
    shows: "loud-photo",
  },
  {
    name: "a copy whose slot the page fills",
    document: page([
      placement(
        "p",
        "card",
        {},
        {
          slots: {
            extra: [block("mine", "core/text", { text: "The author's words" })],
          },
        }
      ),
    ]),
    shows: "The author&#x27;s words",
  },
  {
    name: "a copy filling the slot of another copy, beside a linked component",
    document: page([
      placement(
        "outer",
        "card",
        { variant: "loud" },
        {
          slots: {
            extra: [
              placement("inner", "card", {
                overrides: { title: "Inner title" },
              }),
              placement("n", "note"),
            ],
          },
        }
      ),
    ]),
    shows: "Inner title",
  },
];

describe("a page whose copies become plain blocks renders the same", () => {
  it.each(CASES)("for $name", async ({ document, shows }) => {
    const after = converted(document);

    // The controls: the page drew the case's content at all, and the
    // conversion really unlinked every copy.
    const before = await markup(document);
    expect(before).toContain(shows);
    expect(JSON.stringify(after)).not.toContain('"componentId":"card"');
    expect(normalised(await markup(after))).toBe(normalised(before));
  });

  it("leaves the other component linked", () => {
    const after = converted(CASES[5]!.document);

    expect(JSON.stringify(after)).toContain('"componentId":"note"');
  });

  it("is told apart from a conversion that dropped a value", async () => {
    // The comparison's own control: a render that lost the placement's image
    // differs, so a normalisation that hid such a change would fail here.
    const kept = page([
      placement("p", "card", { overrides: { photo: "page-photo" } }),
    ]);
    const lost = page([placement("p", "card")]);

    expect(normalised(await markup(lost))).not.toBe(
      normalised(await markup(kept))
    );
  });
});
