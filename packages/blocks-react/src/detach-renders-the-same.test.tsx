/**
 * Detaching a placement leaves the page looking exactly the same.
 *
 * Each case renders a page through the published renderer, detaches one
 * placement with the engine's planner, renders again, and compares the two
 * markups once node ids and per-placement DOM ids are set aside: a detach
 * keeps what the author saw, and only the link to the component goes.
 */
import {
  applyOps,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  planDetach,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);
const anyParent = { parentsOf: () => undefined };

const text = (id: string, words: string, extra: Partial<BlockNode> = {}) =>
  ({
    id,
    type: "core/text",
    version: 1,
    props: { text: words },
    ...extra,
  }) as BlockNode;

const heading = (id: string, words: string, extra: Partial<BlockNode> = {}) =>
  ({
    id,
    type: "core/heading",
    version: 1,
    props: { text: words, level: "h2" },
    ...extra,
  }) as BlockNode;

const box = (
  id: string,
  children: BlockNode[],
  extra: Partial<BlockNode> = {}
) =>
  ({
    id,
    type: "core/box",
    version: 1,
    props: {},
    slots: { children },
    ...extra,
  }) as BlockNode;

const placement = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
) =>
  ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId, ...props },
    ...extra,
  }) as BlockNode;

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A card exposing its title, with a variant, a slot and an anchored body. */
const CARD = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    box("frame", [
      heading("title", "Default title"),
      text("body", "The card's own words", { cssId: "card-body" }),
      box("extra", [text("fallback", "Nothing supplied")]),
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
  ],
  slots: { extra: { label: "Extra", nodeId: "extra", slot: "children" } },
  variants: { loud: { label: "Loud", overrides: { title: "LOUD TITLE" } } },
} as unknown as BlockDocument;

/** A banner that places the card inside itself. */
const BANNER = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [box("band", [placement("inner", "card")])],
} as unknown as BlockDocument;

const DEFINITIONS: DefinitionsById = new Map([
  ["card", CARD],
  ["banner", BANNER],
]);

function markup(document: BlockDocument): string {
  return renderToStaticMarkup(
    <PageRenderer
      document={document}
      blocks={blocks}
      definitions={DEFINITIONS}
    />
  );
}

/**
 * The markup with node ids set aside: every DOM id, and every per-node class
 * (`nx-pb-<hash of the node id>`), replaced by its order of first appearance.
 * Node ids and per-placement ids are the one difference a detach is allowed
 * to make.
 */
function normalised(html: string): string {
  const seen = new Map<string, string>();
  const placeholder = (token: string) => {
    const known = seen.get(token);
    if (known !== undefined) return known;
    const next = `@${seen.size}`;
    seen.set(token, next);
    return next;
  };
  return html
    .replace(
      /\sid="([^"]+)"/g,
      (_whole, id: string) => ` id="${placeholder(id)}"`
    )
    .replace(/\bnx-pb-(?!page\b)[a-z0-9]+\b/g, token => placeholder(token));
}

function detached(document: BlockDocument, instanceId: string): BlockDocument {
  const plan = planDetach(document, instanceId, DEFINITIONS, anyParent);
  if (plan.pageOps === undefined) {
    throw new Error(`detach refused: ${String(plan.problem)}`);
  }
  return applyOps(document, plan.pageOps).document;
}

const CASES: { name: string; document: BlockDocument; detach: string }[] = [
  {
    name: "a plain placement",
    document: page([text("before", "Before"), placement("p", "card")]),
    detach: "p",
  },
  {
    name: "a placement with its own value for an exposed field",
    document: page([
      placement("p", "card", { overrides: { title: "This page's title" } }),
    ]),
    detach: "p",
  },
  {
    name: "a placement on a variant",
    document: page([placement("p", "card", { variant: "loud" })]),
    detach: "p",
  },
  {
    name: "a placement with content in its slot",
    document: page([
      placement(
        "p",
        "card",
        {},
        { slots: { extra: [text("mine", "The author's own words")] } }
      ),
    ]),
    detach: "p",
  },
  {
    name: "a placement whose component places another",
    document: page([placement("b", "banner")]),
    detach: "b",
  },
  {
    name: "one of two placements of one component",
    document: page([placement("p1", "card"), placement("p2", "card")]),
    detach: "p2",
  },
];

describe("a detached placement renders the same", () => {
  it.each(CASES)("for $name", ({ document, detach }) => {
    const before = markup(document);
    const after = markup(detached(document, detach));

    // The control: the page drew the component's content at all, so the
    // comparison below is between two renders of it rather than two empties.
    expect(before).toContain("The card");
    expect(normalised(after)).toBe(normalised(before));
  });

  it("is told apart from a detach that dropped an override", () => {
    // The comparison's own control: a render that lost the placement's value
    // differs, so a normalisation that hid such a change would fail here.
    const document = page([
      placement("p", "card", { overrides: { title: "This page's title" } }),
    ]);
    const lost = page([placement("p", "card")]);

    expect(normalised(markup(lost))).not.toBe(normalised(markup(document)));
  });
});
