/**
 * A collection list tells an editor how many entries it drew, as it draws
 * them: the entries a read found, or none where the page's read allowance
 * refused the read, so what the editor says of the list is of what it drew.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createQueryBudget, createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from ".";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

const resolver = createBlockResolver(coreBlocks);

const LIST = "list";

/** A page holding one list of posts, each drawn with its title. */
const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: LIST,
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 10 },
      slots: {
        children: [
          {
            id: "t",
            type: "core/text",
            version: 1,
            props: { text: "Entry" },
          },
        ],
      },
    },
  ],
};

const POSTS = [{ id: "a" }, { id: "b" }, { id: "c" }];

async function drawWith(allowance: number | undefined) {
  const shown = vi.fn<(nodeId: string, count: number) => void>();
  const find = vi.fn(() => Promise.resolve({ items: POSTS, total: 3 }));
  await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      context={createStandaloneContext({
        data: { find },
        diagnostics: true,
        listShown: shown,
        ...(allowance === undefined
          ? {}
          : { queries: createQueryBudget(allowance) }),
      })}
    />
  );
  return { shown, find };
}

describe("a list telling an editor how many entries it drew", () => {
  it("tells the entries its read found", async () => {
    const { shown } = await drawWith(undefined);
    expect(shown).toHaveBeenCalledWith(LIST, 3);
  });

  it("tells none where the page's allowance refused its read", async () => {
    const { shown, find } = await drawWith(0);
    // CONTROL: the read was refused, so nothing was read.
    expect(find).not.toHaveBeenCalled();
    expect(shown).toHaveBeenCalledWith(LIST, 0);
    expect(shown).not.toHaveBeenCalledWith(LIST, 3);
  });
});

describe("a list inside another list's entries", () => {
  it("tells no count, being drawn once per entry under one id", async () => {
    const [list] = document.nodes;
    if (list === undefined) throw new Error("the page holds its list");
    const nested: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "outer",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts", limit: 10 },
          slots: { children: [{ ...list, id: "inner" }] },
        },
      ],
    };
    const shown = vi.fn<(nodeId: string, count: number) => void>();
    await renderToHtml(
      <PageRenderer
        document={nested}
        blocks={resolver}
        siteStyles={false}
        context={createStandaloneContext({
          data: { find: () => Promise.resolve({ items: POSTS, total: 3 }) },
          diagnostics: true,
          listShown: shown,
        })}
      />
    );
    // CONTROL: the outer list, drawn once, tells its count.
    expect(shown).toHaveBeenCalledWith("outer", 3);
    expect(shown.mock.calls.some(([id]) => id === "inner")).toBe(false);
  });
});
