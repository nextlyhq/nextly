// @vitest-environment jsdom
/**
 * A block's own CSS class names on its root element: on the published page and
 * on the canvas, after the classes Nextly generates and apart from the shared
 * styles, for a core block and a plugin's block alike. A page stored without
 * them renders byte for byte as it did.
 */
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { coreBlocks } from "./blocks/index";
import { defineBlock } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

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

/** A plugin's block: it forwards the class it is handed, and nothing else. */
const pluginNote = defineBlock<{ value: string }>({
  name: "acme/note",
  version: 1,
  description: "A note.",
  example: { props: { value: "hi" } },
  defaultProps: { value: "" },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

const blocks = createBlockResolver([
  ...(coreBlocks as AnyBlockDefinition[]),
  pluginNote as AnyBlockDefinition,
]);

const framed: NamedClass = {
  id: "c-framed",
  slug: "framed",
  orderIndex: 0,
  styles: { base: { base: { borderRadius: "4px" } } } as never,
};

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A Section wearing its own style and a shared style, holding one note. */
function section(extra: Partial<BlockNode> = {}): BlockNode {
  return {
    id: "hero",
    type: "core/section",
    version: 1,
    props: { as: "section" },
    classes: [framed.id],
    styles: { base: { base: { paddingTop: "8px" } } } as never,
    slots: {
      children: [
        {
          id: "note",
          type: "acme/note",
          version: 1,
          props: { value: "Plans from $29" },
        },
      ],
    },
    ...extra,
  };
}

function render(document: BlockDocument, canvas: boolean): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={document}
      blocks={blocks}
      styleContext={{ breakpoints: BREAKPOINTS, namedClasses: [framed] }}
      {...(canvas ? { nodeAttribute: true } : {})}
    />
  );
}

/** The class list of the first element of this tag, in order. */
function classesOf(html: string, tag: string): string[] {
  const element = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(tag);
  if (element === null) throw new Error(`no <${tag}>`);
  return [...element.classList];
}

describe.each([
  ["the published page", false],
  ["the canvas", true],
])("on %s", (_, canvas) => {
  it("puts the author's names on the block's root, after Nextly's own", async () => {
    const html = await render(
      page(section({ cssClasses: "promo hero-dark" })),
      canvas
    );
    const list = classesOf(html, "section");
    expect(list.slice(-2)).toEqual(["promo", "hero-dark"]);
    const generated = list.slice(0, -2);
    // The generated ones, all of them still there: the node's own class, the
    // shared style's and the block type's.
    expect(generated.length).toBeGreaterThanOrEqual(3);
    expect(generated.every(name => name.startsWith("nx-"))).toBe(true);
    expect(generated).toContain("nx-bt-core--section");
    expect(generated.some(name => name.startsWith("nx-c-"))).toBe(true);
  });

  it("gives a plugin's block its names with no opt-in", async () => {
    const html = await render(
      page(section({ slots: { children: [] } }), {
        id: "aside",
        type: "acme/note",
        version: 1,
        props: { value: "Aside" },
        cssClasses: "callout",
      }),
      canvas
    );
    expect(classesOf(html, "p").at(-1)).toBe("callout");
  });

  it("draws none of the names a save would refuse", async () => {
    const html = await render(
      page(section({ cssClasses: "promo nx-box 2col .x" })),
      canvas
    );
    const list = classesOf(html, "section");
    expect(list.at(-1)).toBe("promo");
    expect(list).not.toContain("nx-box");
    expect(list).not.toContain("2col");
  });

  it("renders a page stored without them as it did", async () => {
    const before = await render(page(section()), canvas);
    for (const cssClasses of ["", "   ", "nx-box"]) {
      expect(await render(page(section({ cssClasses })), canvas)).toBe(before);
    }
    expect(
      await render(
        page(section({ cssClasses: ["promo"] as unknown as string })),
        canvas
      )
    ).toBe(before);
  });
});
