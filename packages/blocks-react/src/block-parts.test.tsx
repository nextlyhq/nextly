/**
 * The contract that lets a block style an element it draws inside its root.
 *
 * Both halves are asserted together, because either alone is inert and the
 * failure is silent — the same shape `inline-props.test.tsx` guards. A part
 * declared but never marked gives the compiled rule no element to land on; an
 * element marked for a part that was never declared wears a class no rule
 * targets. Neither shows up as an error, and both render a page that simply
 * looks wrong.
 *
 * @module block-parts.test
 */
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

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

/** A block that draws a caption beside its own content and marks it. */
const captioned = {
  name: "test/captioned",
  version: 1,
  description: "Draws a figure with a caption inside it.",
  example: { props: {} },
  parts: { caption: { baseStyles: { base: { base: { fontSize: "1em" } } } } },
  render: ({
    className,
    partClass,
  }: {
    className: string;
    partClass: (name: string) => string;
  }) => (
    <figure className={className}>
      <figcaption className={partClass("caption")}>A caption</figcaption>
      {/* A name the block never declared. */}
      <span className={partClass("nonesuch")}>Undeclared</span>
    </figure>
  ),
} as unknown as AnyBlockDefinition;

async function html(): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={
        {
          formatVersion: 1,
          kind: "page",
          nodes: [{ id: "n1", type: "test/captioned", version: 1, props: {} }],
        } as unknown as BlockDocument
      }
      blocks={createBlockResolver([captioned])}
    />
  );
}

describe("the class a block marks one of its own elements with", () => {
  it("carries the block that owns it, not just the part name", async () => {
    // A bare `nx-bp-caption` would be worn by every block's caption, so one
    // block's defaults would land on another's element wherever they nest.
    expect(await html()).toContain('class="nx-bp-test--captioned--caption"');
  });

  it("stays off the block's own root, which keeps its own class", async () => {
    const out = await html();
    // Two elements answering to one identity is the defect the part mechanism
    // exists to avoid, not one it may reintroduce.
    expect(out).toMatch(/<figure class="nx-pb-[^"]*"/);
    expect(out).not.toMatch(/<figure class="[^"]*nx-bp-/);
  });

  it("is EMPTY for a name the block never declared", async () => {
    // The failure this shapes: a typo yields no class rather than a class no
    // rule targets. Both are inert; only one is greppable.
    const out = await html();
    expect(out).toContain('<span class="">');
    expect(out).not.toContain("nonesuch");
  });
});
