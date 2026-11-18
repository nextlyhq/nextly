// @vitest-environment jsdom
/**
 * What an Image's empty state decides without drawing: which boxes are
 * Images waiting for a picture, whether a file is a picture, whether a link
 * is one the page draws and loads, and what a choice writes.
 *
 * The boxes are found in markup the Image block itself rendered, through the
 * page renderer as the canvas draws it, so the attribute this module reads is
 * the one the block writes.
 *
 * @module canvas/image-states-model.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  createBlockResolver,
  createStandaloneContext,
  PageRenderer,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  carriesFiles,
  chosenFile,
  emptyImageBoxes,
  linkAddress,
  loadsAsImage,
  pictureOp,
  takesPicture,
} from "./image-states-model";

afterEach(() => {
  vi.useRealTimers();
});

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

function imageNode(id: string, props: Record<string, unknown>): BlockNode {
  return { id, type: "core/image", version: 1, props };
}

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
}

/** The page as the canvas draws it, in a canvas root of its own. */
async function canvasOf(document: BlockDocument): Promise<HTMLElement> {
  const root = window.document.createElement("div");
  root.innerHTML = await html(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      siteStyles={false}
      nodeAttribute
      context={createStandaloneContext({
        diagnostics: true,
        resolveMedia: id =>
          Promise.resolve(
            id === "kept" ? { url: "https://cdn.example/kept.jpg" } : null
          ),
      })}
    />
  );
  return root;
}

describe("the Image boxes waiting for a picture", () => {
  it("are found in what the Image block draws, with why each is empty", async () => {
    const document = page(
      imageNode("new", {}),
      imageNode("gone", { mediaId: "deleted" }),
      imageNode("shown", { mediaId: "kept" })
    );
    const boxes = emptyImageBoxes(await canvasOf(document), document);
    expect(boxes.map(({ nodeId, reason }) => [nodeId, reason])).toEqual([
      ["new", "empty"],
      ["gone", "missing"],
    ]);
  });

  it("leaves out a box this page does not hold, and one a component placed", () => {
    const root = window.document.createElement("div");
    root.innerHTML = [
      '<div data-nx-node="layout-image" data-nx-image-empty="empty"></div>',
      '<div data-nx-node="inner" data-nx-instance="placed" data-nx-image-empty="empty"></div>',
      '<div data-nx-node="own" data-nx-image-empty="empty"></div>',
    ].join("");
    const document = page(imageNode("own", {}), imageNode("inner", {}));
    expect(emptyImageBoxes(root, document).map(box => box.nodeId)).toEqual([
      "own",
    ]);
  });

  it("leaves a bound Image to its binding", () => {
    expect(takesPicture(imageNode("a", {}))).toBe(true);
    expect(
      takesPicture({
        ...imageNode("b", {}),
        bindings: { mediaId: { $bind: "entry.cover" } },
      } as BlockNode)
    ).toBe(false);
    expect(
      takesPicture({
        ...imageNode("c", {}),
        bindings: { src: { $bind: "entry.photoUrl" } },
      } as BlockNode)
    ).toBe(false);
  });
});

describe("a file handed over", () => {
  it("is a picture by the type the browser read it as", () => {
    const png = new File(["x"], "photo.png", { type: "image/png" });
    const pdf = new File(["x"], "brief.pdf", { type: "application/pdf" });
    expect(chosenFile([png])).toEqual({ file: png, image: true });
    expect(chosenFile([pdf])).toEqual({ file: pdf, image: false });
    // The first of several, and nothing for none.
    expect(chosenFile([pdf, png])?.file).toBe(pdf);
    expect(chosenFile([])).toBeUndefined();
    expect(chosenFile(null)).toBeUndefined();
  });

  it("comes only from a drag that carries files", () => {
    expect(carriesFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(
      true
    );
    expect(
      carriesFiles({ types: ["text/plain"] } as unknown as DataTransfer)
    ).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe("a typed link", () => {
  it("passes the rule the Image block draws by", () => {
    expect(linkAddress("  https://cdn.example/a.png ", undefined)).toBe(
      "https://cdn.example/a.png"
    );
    expect(linkAddress("/uploads/a.png", undefined)).toBe("/uploads/a.png");
    expect(linkAddress("javascript:alert(1)", undefined)).toBeUndefined();
    expect(linkAddress("   ", undefined)).toBeUndefined();
  });

  it("is refused from a host the site does not load pictures from", () => {
    const patterns = [{ protocol: "https", hostname: "cdn.example" }] as never;
    expect(linkAddress("https://cdn.example/a.png", patterns)).toBe(
      "https://cdn.example/a.png"
    );
    expect(linkAddress("https://elsewhere.example/a.png", patterns)).toBe(
      undefined
    );
  });
});

describe("whether a link loads as a picture", () => {
  /** A document whose pictures load, or fail, as the case says. */
  function documentWhere(outcome: "load" | "empty" | "error" | "never") {
    const probe = {
      naturalWidth: outcome === "load" ? 640 : 0,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(_value: string) {
        if (outcome === "error") queueMicrotask(() => probe.onerror?.());
        else if (outcome !== "never") queueMicrotask(() => probe.onload?.());
      },
    };
    return { createElement: () => probe } as unknown as Document;
  }

  it("answers yes for a picture with a size", async () => {
    await expect(loadsAsImage("/a.png", documentWhere("load"))).resolves.toBe(
      true
    );
  });

  it("answers no for an address that fails, or loads nothing to draw", async () => {
    await expect(loadsAsImage("/a.png", documentWhere("error"))).resolves.toBe(
      false
    );
    await expect(loadsAsImage("/a.png", documentWhere("empty"))).resolves.toBe(
      false
    );
  });

  it("answers no for one that never answers, once its time is up", async () => {
    vi.useFakeTimers();
    const answer = loadsAsImage("/a.png", documentWhere("never"), 1000);
    vi.advanceTimersByTime(1000);
    await expect(answer).resolves.toBe(false);
  });
});

describe("what a choice writes", () => {
  it("gives the Image its library file, keeping an address typed before", () => {
    const document = page(
      imageNode("a", { src: "https://cdn.example/old.png", alt: "Kept" })
    );
    expect(pictureOp(document, "a", { mediaId: "m1" })).toEqual({
      kind: "update",
      id: "a",
      patch: {
        props: {
          src: "https://cdn.example/old.png",
          alt: "Kept",
          mediaId: "m1",
        },
      },
    });
  });

  it("gives it an address, dropping a library file", () => {
    const document = page(imageNode("a", { mediaId: "gone", alt: "Kept" }));
    expect(
      pictureOp(document, "a", { address: "https://cdn.example/a.png" })
    ).toEqual({
      kind: "update",
      id: "a",
      patch: { props: { alt: "Kept", src: "https://cdn.example/a.png" } },
    });
  });

  it("writes nothing for a block that is not an Image, or is gone", () => {
    const document = page({
      id: "t",
      type: "core/text",
      version: 1,
      props: {},
    });
    expect(pictureOp(document, "t", { mediaId: "m1" })).toBeNull();
    expect(pictureOp(document, "missing", { mediaId: "m1" })).toBeNull();
  });
});
