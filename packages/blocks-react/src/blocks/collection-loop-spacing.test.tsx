// @vitest-environment jsdom

/**
 * The space inside and between a configured collection loop's entries, on the
 * markup the renderer actually draws.
 *
 * A configured loop wraps each entry's blocks in an element of its own, so a
 * rule written as "every child after the first" on the loop reaches the entry
 * wrappers and not the blocks inside an entry. This renders a loop over two
 * entries, compiles the page's sheet, and asks the DOM which elements the
 * compiled gap selector actually matches.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const node = (id: string, type: string, extra: object = {}): BlockNode =>
  ({ id, type, version: 1, props: {}, ...extra }) as BlockNode;

const DOC: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    node("loop", "core/collection-loop", {
      props: { collection: "posts" },
      slots: {
        children: [
          node("title", "core/heading", {
            props: { text: "Entry title", level: "h3" },
          }),
          node("body", "core/text", { props: { text: "Entry body" } }),
        ],
      },
    }),
  ],
};

const CONTEXT = {
  entry: null,
  data: {
    find: () =>
      Promise.resolve({
        items: [
          { id: "e1", title: "One" },
          { id: "e2", title: "Two" },
        ],
        total: 2,
      }),
  },
  resolveMedia: () => Promise.resolve(null),
  resolveEntryPath: () => Promise.resolve(null),
} as unknown as PageContext;

async function drawn(): Promise<HTMLElement> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={DOC}
      blocks={createBlockResolver(coreBlocks)}
      context={CONTEXT}
      styleContext={{
        breakpoints: {
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        },
      }}
    />,
    {
      onError(error: unknown) {
        throw error;
      },
    }
  );
  await stream.allReady;
  const host = document.createElement("div");
  host.innerHTML = await new Response(stream).text();
  return host;
}

/** The selectors of every compiled rule setting `margin-block-start` to the stack gap. */
function gapSelectors(host: HTMLElement): string[] {
  const css = Array.from(host.querySelectorAll("style"))
    .map(style => style.textContent ?? "")
    .join("\n");
  return css
    .split("\n")
    .map(line => line.trim())
    .filter(line =>
      line.includes("margin-block-start: var(--site-space-stack)")
    )
    .map(line => line.slice(0, line.indexOf("{")).trim());
}

function matchedByGap(host: HTMLElement, element: Element): boolean {
  return gapSelectors(host).some(selector => element.matches(selector));
}

describe("a configured collection loop", () => {
  it("spaces the blocks inside each entry by the stack gap", async () => {
    const host = await drawn();
    const bodies = Array.from(host.querySelectorAll("p")).filter(
      element => element.textContent === "Entry body"
    );
    // Population: one body per entry, so the loop really drew two entries.
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(matchedByGap(host, body)).toBe(true);
    }
    // The first block of an entry is never spaced from inside it.
    const titles = Array.from(host.querySelectorAll("h3"));
    expect(titles).toHaveLength(2);
    for (const title of titles) {
      expect(matchedByGap(host, title)).toBe(false);
    }
  });

  it("separates the second entry from the first", async () => {
    const host = await drawn();
    const entries = Array.from(host.querySelectorAll("h3")).map(
      title => title.parentElement
    );
    expect(entries).toHaveLength(2);
    expect(entries[0] === null ? true : matchedByGap(host, entries[0])).toBe(
      false
    );
    expect(entries[1] === null ? false : matchedByGap(host, entries[1])).toBe(
      true
    );
  });
});
