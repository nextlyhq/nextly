/**
 * The marker that lets the editor find a container without knowing its name.
 *
 * A block-name list would exclude every plugin container, so the canvas asks a
 * structural question instead: does this block declare slots at all.
 */
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { SLOTS_ATTRIBUTE } from "./block-boundary";
import { coreBlocks } from "./blocks";
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

function doc(nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

function html(document: BlockDocument, forEditor: boolean): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks as AnyBlockDefinition[])}
      {...(forEditor ? { nodeAttribute: true } : {})}
    />
  );
}

const emptyBox = {
  id: "box-1",
  type: "core/box",
  version: 1,
  props: {},
  // A node with neither `cssId` nor an author attribute takes an early return
  // inside the boundary whenever the render is not for the editor, before any
  // editor marker is even considered — so a bare node would pass the published
  // render below regardless of whether the slots gate itself is correct.
  // Setting `cssId` routes the render through the same code path a real page
  // takes once its author sets an anchor, which is where that gate runs.
  cssId: "box-1",
};

const spacer = {
  id: "spacer-1",
  type: "core/spacer",
  version: 1,
  props: {},
};

describe("the container marker", () => {
  it("marks a block that declares slots", async () => {
    const markup = await html(doc([emptyBox]), true);
    expect(markup).toContain(SLOTS_ATTRIBUTE);
  });

  it("does NOT mark a block that declares no slots", async () => {
    // The positive control sits in the same render: `core/spacer` is
    // deliberately empty, and marking it would give the canvas a dashed box
    // around something that is meant to be invisible space.
    const markup = await html(doc([emptyBox, spacer]), true);
    const marks = markup.split(SLOTS_ATTRIBUTE).length - 1;
    expect(marks).toBe(1);
  });

  it("never marks a published render", async () => {
    const markup = await html(doc([emptyBox]), false);
    expect(markup).not.toContain(SLOTS_ATTRIBUTE);
  });
});
