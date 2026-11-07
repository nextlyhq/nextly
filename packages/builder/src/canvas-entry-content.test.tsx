// @vitest-environment jsdom

/**
 * A template's Entry content block on the canvas while visibility conditions
 * are applied for the previewed entry: the conditions leave the page as a
 * visitor reading that entry would get it, and the entry's own blocks are
 * composed into what they leave, so a shown Entry content block still draws
 * the entry's Body and a hidden one is drawn as its one-line marker.
 *
 * The blocks are stand-ins drawing what the real ones would: Entry content
 * its composed slot, or the canvas's note when it holds nothing, so a page
 * drawn without the entry's blocks says "has no Body content yet".
 */
import { act, cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  clearBlocks,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { appliedConditionsOf } from "./applied-conditions";
import { Canvas } from "./canvas";
import { conditionFieldsOfShapes } from "./condition-model";
import {
  PreviewedEntryProvider,
  type PreviewedCollection,
  type PreviewedEntry,
} from "./previewed-entry";

const BODY_WORDS = "A content model is the set of collections you build on.";

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        // Draws its composed slot, else the canvas's note, as the real
        // block does.
        name: ENTRY_CONTENT_TYPE,
        version: 1,
        description: "The entry's own content.",
        example: { props: {} },
        slots: { [ENTRY_CONTENT_SLOT]: { lock: "all" } },
        render: ({
          node,
          ctx,
          className,
          renderSlot,
        }: {
          node: {
            props: { field?: string };
            slots?: Record<string, unknown[]>;
          };
          ctx: {
            entryContentCanvas?: {
              noteFor: (field: string | undefined) => {
                lead?: string;
                words: string;
              };
            };
          };
          className: string;
          renderSlot: (name: string) => ReactNode;
        }) => {
          const held = node.slots?.[ENTRY_CONTENT_SLOT] ?? [];
          if (held.length > 0) {
            return createElement(
              "div",
              { className },
              renderSlot(ENTRY_CONTENT_SLOT)
            );
          }
          const note = ctx.entryContentCanvas?.noteFor(node.props.field);
          return createElement(
            "div",
            { className },
            note === undefined
              ? null
              : `${note.lead ?? ""} ${note.words}`.trim()
          );
        },
      },
      {
        name: "acme/words",
        version: 1,
        description: "Words.",
        example: { props: {} },
        render: ({
          node,
          className,
        }: {
          node: { props: { text?: string } };
          className: string;
        }) => createElement("p", { className }, node.props.text),
      },
    ] as never,
    { source: "canvas-entry-content-test" }
  );
});

afterEach(cleanup);

/** The articles template: Entry content drawing Body, for VIP articles only. */
const TEMPLATE: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "ec",
      type: ENTRY_CONTENT_TYPE,
      version: 1,
      props: { field: "body" },
      visibility: {
        conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
      },
    },
  ],
};

const ARTICLES: PreviewedCollection = {
  slug: "articles",
  singular: "article",
  plural: "Articles",
  blocksFields: [{ name: "body", label: "Body" }],
  fieldLabel: name => (name === "body" ? "Body" : name),
  entryHref: id => `/admin/collections/articles/${id}`,
};

/** The article previewed, whose Body holds one block of words. */
const ARTICLE: PreviewedEntry = {
  kind: "entry",
  collection: "articles",
  id: "a1",
  title: "Building a content model",
  editorValues: {
    body: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "w1",
          type: "acme/words",
          version: 1,
          props: { text: BODY_WORDS },
        },
      ],
    },
  },
  publicValues: null,
  fields: [],
};

/** The conditions applied for an article whose tier is `tier`. */
function appliedFor(tier: string) {
  const fields = [{ name: "tier", type: "text" }] as const;
  return appliedConditionsOf(
    TEMPLATE,
    {
      subject: {
        fields: { declared: new Set(["tier"]), readable: fields },
        values: { tier },
      },
      noun: "article",
      fields: conditionFieldsOfShapes(fields),
    },
    node => (node.id === "ec" ? "Entry content" : node.id)
  );
}

/** The template drawn for the article, with conditions applied or not. */
async function drawn(
  applied?: ReturnType<typeof appliedFor>
): Promise<HTMLElement> {
  const { container } = render(
    <PreviewedEntryProvider value={ARTICLE} collection={ARTICLES}>
      <Canvas
        document={TEMPLATE}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        {...(applied === undefined ? {} : { conditionsApplied: applied })}
      />
    </PreviewedEntryProvider>
  );
  await act(async () => undefined);
  return container;
}

describe("Entry content with conditions applied", () => {
  it("draws the entry's Body without conditions applied (the control)", async () => {
    const container = await drawn();
    expect(container.textContent).toContain(BODY_WORDS);
  });

  it("keeps the entry's Body when its conditions hold for the entry", async () => {
    const applied = appliedFor("vip");
    // The control: the conditions do show the block.
    expect(applied.shown.has("ec")).toBe(true);
    const container = await drawn(applied);
    expect(container.textContent).toContain(BODY_WORDS);
    expect(container.textContent).not.toContain("has no Body content yet");
  });

  it("draws the hidden line in its place when they don't", async () => {
    const container = await drawn(appliedFor("free"));
    const marker = container.querySelector(".nx-condition-hidden");
    expect(marker?.getAttribute("data-nx-node")).toBe("ec");
    expect(marker?.textContent).toBe(
      "Entry content · hidden for this article: tier is not vip"
    );
    expect(container.textContent).not.toContain(BODY_WORDS);
  });
});
