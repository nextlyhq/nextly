/**
 * The contract that makes inline editing possible: a block says which of its
 * values a canvas may let an author type into, and which element holds it.
 *
 * Both halves are asserted together, because either alone is inert and the
 * failure is silent. A prop declared `inline` whose element is never marked
 * gives an editor nothing to attach to; an element marked for a prop that was
 * never declared gives an editor a region the block never offered.
 *
 * @module inline-props.test
 */
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { NODE_ID_ATTRIBUTE, PROP_ATTRIBUTE } from "./block-boundary";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

import type {
  AnyBlockDefinition,
  BlockDocument,
} from "@nextlyhq/blocks-engine";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

function documentOf(
  type: string,
  props: Record<string, unknown>
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type, version: 1, props }],
  } as unknown as BlockDocument;
}

/** Render as an editor does, or as a published page does. */
function html(document: BlockDocument, forEditor: boolean): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks as AnyBlockDefinition[])}
      {...(forEditor ? { nodeAttribute: true } : {})}
    />
  );
}

describe("a block marks the element carrying an inline prop", () => {
  it("marks the heading's own element when it has no link", async () => {
    const markup = await html(
      documentOf("core/heading", { text: "Hello" }),
      true
    );

    expect(markup).toContain(`${PROP_ATTRIBUTE}="text"`);
    // On the heading itself, which is where the words are.
    expect(markup).toMatch(new RegExp(`<h2[^>]*${PROP_ATTRIBUTE}="text"`));
  });

  it("marks the ANCHOR instead once the heading is linked", async () => {
    // The property no editor could infer: the same prop renders into a
    // different element depending on another prop's value.
    const markup = await html(
      documentOf("core/heading", {
        text: "Hello",
        href: "https://example.com",
      }),
      true
    );

    expect(markup).toMatch(new RegExp(`<a[^>]*${PROP_ATTRIBUTE}="text"`));
    expect(markup).not.toMatch(new RegExp(`<h2[^>]*${PROP_ATTRIBUTE}="text"`));
  });

  it("marks the text block's paragraph", async () => {
    const markup = await html(documentOf("core/text", { text: "Words" }), true);

    expect(markup).toMatch(new RegExp(`<p[^>]*${PROP_ATTRIBUTE}="text"`));
  });

  it("marks a quote's two element-bearing values, and not the third", async () => {
    // `attribution` is a bare text node with no element to carry an attribute,
    // so it is deliberately not offered for inline editing.
    const markup = await html(
      documentOf("core/quote", {
        text: "Quoted",
        attribution: "Someone",
        source: "A Book",
      }),
      true
    );

    expect(markup).toMatch(new RegExp(`<p[^>]*${PROP_ATTRIBUTE}="text"`));
    expect(markup).toMatch(new RegExp(`<cite[^>]*${PROP_ATTRIBUTE}="source"`));
    expect(markup).not.toContain(`${PROP_ATTRIBUTE}="attribution"`);
  });
});

describe("a published page carries none of it", () => {
  it.each([
    ["core/heading", { text: "Hello" }],
    ["core/heading", { text: "Hello", href: "https://example.com" }],
    ["core/text", { text: "Words" }],
    ["core/quote", { text: "Quoted", attribution: "A", source: "B" }],
  ] as const)(
    "%s renders without the marker outside an editor",
    async (type, props) => {
      const markup = await html(documentOf(type, props), false);

      expect(markup).not.toContain(PROP_ATTRIBUTE);
      // The control: this render produced the block at all, so the absence above
      // is about the marker rather than about an empty page.
      expect(markup.length).toBeGreaterThan(10);
      expect(markup).toContain(String(props.text));
    }
  );
});

describe("the declaration and the marking must agree", () => {
  it("marks nothing for a prop the block never declared inline", async () => {
    // `rel` is a real heading prop with a schema and no `inline`, so a block
    // marking it would still get silence — the renderer, not the block, is
    // what decides an element is offered.
    const markup = await html(
      documentOf("core/heading", { text: "Hello", rel: "nofollow" }),
      true
    );

    expect(markup).not.toContain(`${PROP_ATTRIBUTE}="rel"`);
    // Control: the marker mechanism ran on this render.
    expect(markup).toContain(`${PROP_ATTRIBUTE}="text"`);
  });

  it("every prop declared inline is marked somewhere by its block", async () => {
    // The half that rots. A prop can gain `inline: true` in a schema while
    // nobody touches the render, and the result is a promise the canvas cannot
    // keep — invisible until an author double-clicks and nothing happens.
    const declared = coreBlocks.flatMap(block =>
      Object.entries(block.props ?? {})
        .filter(
          ([, schema]) => (schema as { inline?: boolean })?.inline === true
        )
        .map(([name]) => [block.name, name] as const)
    );

    // The population, before the verdict: an empty list would satisfy every
    // assertion below by having nothing to contradict.
    expect(declared.length).toBeGreaterThan(0);

    for (const [blockName, propName] of declared) {
      const definition = coreBlocks.find(block => block.name === blockName);
      const example = definition?.example?.props ?? {};
      const markup = await html(
        documentOf(blockName, { ...example, [propName]: "Sample text" }),
        true
      );
      expect(
        markup,
        `${blockName} declares "${propName}" inline but never marks an element for it`
      ).toContain(`${PROP_ATTRIBUTE}="${propName}"`);
    }
  });
});

describe("a document cannot forge the editor's own markers", () => {
  const forged = (attributes: Record<string, string>): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/heading",
          version: 1,
          props: { text: "Hello" },
          attributes,
        },
      ],
    }) as unknown as BlockDocument;

  it("drops an authored marker while rendering FOR the editor", async () => {
    /*
     * All three markers share the editor's namespace and all three matter: the
     * node id decides which block a click selects, the prop marker decides
     * which property inline editing commits into, and the canvas treats a
     * chrome ancestor as its own UI and ignores clicks inside it. A document can
     * arrive from an import or a script, so the panel that offers this field is
     * not the only way one is written.
     */
    const markup = await html(
      forged({
        [NODE_ID_ATTRIBUTE]: "somewhere-else",
        [PROP_ATTRIBUTE]: "another-prop",
        "data-nx-chrome": "true",
      }),
      true
    );

    expect(markup).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
    expect(markup).not.toContain("somewhere-else");
    expect(markup).not.toContain("another-prop");
    expect(markup).not.toContain("data-nx-chrome");
  });

  it("keeps an ordinary author attribute beside them", async () => {
    // The control: the namespace is reserved, `data-` is not.
    const markup = await html(
      forged({ "data-analytics": "hero", [PROP_ATTRIBUTE]: "another-prop" }),
      true
    );
    expect(markup).toContain('data-analytics="hero"');
    expect(markup).not.toContain("another-prop");
  });

  it("leaves them alone on a PUBLISHED page", async () => {
    /*
     * Off the editor there is no marker to protect and no hit-testing to
     * confuse: these are ordinary author data, and dropping them would be this
     * system taking a namespace it is not using.
     */
    const markup = await html(forged({ "data-nx-chrome": "true" }), false);
    expect(markup).toContain('data-nx-chrome="true"');
  });
});
