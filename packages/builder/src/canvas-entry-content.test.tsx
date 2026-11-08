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
  composeEntryContent,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  entryBlocksDocumentOf,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { ENTRY_CONTENT_DRAWN_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { appliedConditionsOf, conditionedBlocksIn } from "./applied-conditions";
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
              {
                className,
                ...(ctx.entryContentCanvas === undefined
                  ? {}
                  : { [ENTRY_CONTENT_DRAWN_ATTRIBUTE]: "" }),
              },
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
      {
        name: "acme/link",
        version: 1,
        description: "A link.",
        example: { props: {} },
        render: ({
          node,
          className,
        }: {
          node: { props: { text?: string } };
          className: string;
        }) => createElement("a", { className, href: "#top" }, node.props.text),
      },
      {
        // A canvas drawn inside the page's, as a component's own view
        // draws one: the inner template, with its own Entry content.
        name: "acme/nested",
        version: 1,
        description: "A canvas inside the canvas.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "div",
            { className },
            createElement(Canvas, {
              document: PLAIN,
              siteStyles: { breakpoints: { viewport: [], container: [] } },
            })
          ),
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

/** `template` with `article`'s Body composed in, as the host draws it. */
function composedFor(
  template: BlockDocument,
  article: PreviewedEntry = ARTICLE
): BlockDocument {
  return composeEntryContent(template, {
    valueOf: field =>
      article.kind === "entry"
        ? (entryBlocksDocumentOf(article.editorValues[field]) ?? undefined)
        : undefined,
  });
}

/**
 * The conditions applied for an article whose tier is `tier`, to the page as
 * drawn: the template with the article's Body composed in, as the host
 * applies them.
 */
function appliedFor(
  tier: string,
  template: BlockDocument = TEMPLATE,
  article: PreviewedEntry = ARTICLE,
  /** The page they are applied to: the template as drawn, by default. */
  page: BlockDocument = composedFor(template, article)
) {
  const fields = [{ name: "tier", type: "text" }] as const;
  return appliedConditionsOf(
    page,
    {
      subject: {
        fields: { declared: new Set(["tier"]), readable: fields },
        values: { tier },
      },
      noun: "article",
      fields: conditionFieldsOfShapes(fields),
    },
    node =>
      node.id === "ec"
        ? "Entry content"
        : typeof node.props.text === "string"
          ? node.props.text
          : node.id
  );
}

/** The template drawn for the article, with conditions applied or not. */
async function drawn(
  applied?: ReturnType<typeof appliedFor>,
  template: BlockDocument = TEMPLATE,
  article: PreviewedEntry = ARTICLE,
  /**
   * The page as the host composed it, handed with conditions applied to
   * it, as the editor hands both; `null` hands none.
   */
  composed: BlockDocument | null = composedFor(template, article)
): Promise<HTMLElement> {
  const { container } = render(
    <PreviewedEntryProvider value={article} collection={ARTICLES}>
      <Canvas
        document={template}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        {...(applied === undefined ? {} : { conditionsApplied: applied })}
        {...(applied === undefined || composed === null ? {} : { composed })}
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

/** A template whose Entry content block carries no conditions of its own. */
const PLAIN: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    { id: "own", type: "acme/link", version: 1, props: { text: "Own link" } },
    {
      id: "ec",
      type: ENTRY_CONTENT_TYPE,
      version: 1,
      props: { field: "body" },
    },
  ],
};

/** An article whose Body holds a link, and a block for VIP articles only. */
const GATED_ARTICLE: PreviewedEntry = {
  ...ARTICLE,
  editorValues: {
    body: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "l1",
          type: "acme/link",
          version: 1,
          props: { text: "Body link" },
        },
        {
          id: "vip",
          type: "acme/words",
          version: 1,
          props: { text: "Members' worksheet" },
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
          },
        },
      ],
    },
  },
};

describe("a conditioned block inside the entry's Body", () => {
  it("is what offers the switch, where the template's own blocks have none", () => {
    // The control: the template as stored holds no conditioned block.
    expect(conditionedBlocksIn(PLAIN).readingEntry).toBe(false);
    expect(conditionedBlocksIn(composedFor(PLAIN, GATED_ARTICLE))).toEqual({
      any: true,
      readingEntry: true,
      readingItems: false,
    });
  });

  it("is judged and counted, and drawn as its hidden line inside Entry content", async () => {
    const applied = appliedFor("free", PLAIN, GATED_ARTICLE);
    expect(applied.hidden.map(block => block.name)).toEqual([
      "Members' worksheet",
    ]);
    const container = await drawn(applied, PLAIN, GATED_ARTICLE);
    const marker = container.querySelector(".nx-condition-hidden");
    // In the Entry content block's place for it, not the template's own.
    expect(marker?.closest('[data-nx-node="ec"]')).not.toBeNull();
    expect(marker?.textContent).toBe(
      "Members' worksheet · hidden for this article: tier is not vip"
    );
    expect(container.textContent).toContain("Body link");
  });

  it("is drawn as itself when the entry meets its conditions (the control)", async () => {
    const applied = appliedFor("vip", PLAIN, GATED_ARTICLE);
    expect(applied.hidden).toEqual([]);
    expect(applied.shown.size).toBe(1);
    const container = await drawn(applied, PLAIN, GATED_ARTICLE);
    expect(container.querySelector(".nx-condition-hidden")).toBeNull();
    expect(container.textContent).toContain("Members' worksheet");
  });
});

describe("the entry's blocks drawn on the canvas", () => {
  it("are inert, so nothing inside takes focus, while the block's own element is not", async () => {
    const container = await drawn(undefined, PLAIN, GATED_ARTICLE);
    const links = Array.from(container.querySelectorAll("a"));
    const inBody = links.find(link => link.textContent === "Body link");
    const own = links.find(link => link.textContent === "Own link");
    expect(inBody?.closest("[inert]")).not.toBeNull();
    // The control: the template's own link, outside Entry content, is not.
    expect(own?.closest("[inert]")).toBeNull();
    // The Entry content block's own element is what a click lands on.
    const block = container.querySelector('[data-nx-node="ec"]');
    expect(block?.hasAttribute("inert")).toBe(false);
    expect(block?.closest("[inert]")).toBeNull();
  });
});

describe("a conditioned block inside the entry's Body, the switch off", () => {
  it("is badged as conditional on the page as drawn", async () => {
    const container = await drawn(undefined, PLAIN, GATED_ARTICLE);
    const marked = Array.from(
      container.querySelectorAll('[data-nx-conditioned="conditional"]')
    );
    expect(marked.map(element => element.textContent)).toEqual([
      "Members' worksheet",
    ]);
  });

  it("leaves a Body with no conditions unbadged (the control)", async () => {
    const container = await drawn(undefined, PLAIN, ARTICLE);
    expect(container.textContent).toContain(BODY_WORDS);
    expect(container.querySelector("[data-nx-conditioned]")).toBeNull();
  });
});

describe("a canvas drawn inside another", () => {
  it("keeps its entry's blocks inert when the outer canvas marks again", async () => {
    const outer: BlockDocument = {
      formatVersion: 1,
      kind: "template",
      nodes: [{ id: "n", type: "acme/nested", version: 1, props: {} }],
    };
    const tree = (selectedId: string | null) => (
      <PreviewedEntryProvider value={GATED_ARTICLE} collection={ARTICLES}>
        <Canvas
          document={outer}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId={selectedId}
        />
      </PreviewedEntryProvider>
    );
    const { container, rerender } = render(tree(null));
    await act(async () => undefined);
    const bodyLink = () =>
      Array.from(container.querySelectorAll("a")).find(
        link => link.textContent === "Body link"
      );
    // The control: the inner canvas made its entry's blocks inert.
    expect(bodyLink()?.closest("[inert]")).not.toBeNull();
    // A selection on the outer canvas marks it again.
    rerender(tree("n"));
    await act(async () => undefined);
    expect(bodyLink()?.closest("[inert]")).not.toBeNull();
  });
});

describe("a Canvas handed conditions applied, and no composed page", () => {
  it("composes the entry's Body into the page the conditions leave", async () => {
    // A host applying conditions to the template as stored, as before the
    // canvas took a composed page: the Body is composed in by the canvas.
    const applied = appliedFor("vip", TEMPLATE, ARTICLE, TEMPLATE);
    expect(applied.shown.has("ec")).toBe(true);
    const container = await drawn(applied, TEMPLATE, ARTICLE, null);
    expect(container.textContent).toContain(BODY_WORDS);
    expect(container.textContent).not.toContain("has no Body content yet");
  });

  it("draws the host's page as it is where it hands one (the control)", async () => {
    // Applied to the page as composed, a Body block hidden for the entry is
    // its line: the canvas composes nothing over it.
    const applied = appliedFor("free", PLAIN, GATED_ARTICLE);
    const container = await drawn(applied, PLAIN, GATED_ARTICLE);
    expect(container.querySelector(".nx-condition-hidden")).not.toBeNull();
    // Composed over again, the hidden block would draw as itself.
    const drawnAsItself = Array.from(container.querySelectorAll("p")).some(
      element => element.textContent === "Members' worksheet"
    );
    expect(drawnAsItself).toBe(false);
  });
});
