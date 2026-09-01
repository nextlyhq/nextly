/**
 * @vitest-environment jsdom
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageMiniature } from "./PageMiniature";

// The version is DERIVED rather than written as 1: a document literal pinning
// the number keeps parsing after the format moves, and the renderer would then
// refuse it while the fixture still looks correct.
// The block's OWN version, not a literal 1. The renderer drops a node whose
// version it cannot reconcile, and it drops it silently — so a pinned number
// turns into an empty page the day the block is revised, with the fixture still
// reading as correct.
const TEXT = coreBlocks.find(block => block.name === "core/text");
if (!TEXT) throw new Error("core/text is missing from coreBlocks");

const doc = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: TEXT.name,
      version: TEXT.version,
      props: { text: "Hello from the page" },
    },
  ],
} as unknown as BlockDocument;

describe("PageMiniature", () => {
  it("draws the document's own content", () => {
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} />
    );
    expect(container.textContent).toContain("Hello from the page");
  });

  /*
   * A picture, not a workspace. Nothing inside may take focus or a click, and
   * the accessible account of the page is the text beside it — a screen reader
   * reading a whole page layout here would bury the one control that matters.
   */
  it("marks the rendered subtree inert and hidden from assistive technology", () => {
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} />
    );
    const surface = container.querySelector(
      '[data-slot="page-miniature-surface"]'
    );

    expect(surface).not.toBeNull();
    expect(surface?.hasAttribute("inert")).toBe(true);
    expect(surface?.getAttribute("aria-hidden")).toBe("true");
  });

  /*
   * `transform`, never `zoom`. The canvas uses `zoom` because it needs the
   * scaled box to participate in layout for hit-testing and drag geometry; a
   * static picture needs none of that, and `transform` avoids both the reflow
   * and the class of centring defect that participation produced there.
   */
  it("scales by transform from the top left, never by zoom", () => {
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} renderWidth={1280} />
    );
    const scaled = container.querySelector<HTMLElement>(
      '[data-slot="page-miniature-scaled"]'
    );

    expect(scaled).not.toBeNull();
    expect(scaled?.style.width).toBe("1280px");
    expect(scaled?.style.transformOrigin).toBe("top left");
    expect(scaled?.style.getPropertyValue("zoom")).toBe("");
  });

  /*
   * jsdom reports every element as zero-width, which is the same reading a
   * container genuinely gives before layout. Scaling by the measured ratio
   * there would multiply the page by zero and draw nothing at all, so an
   * unmeasurable container renders unscaled rather than blank.
   */
  it("renders unscaled while the container cannot be measured", () => {
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} renderWidth={1280} />
    );
    const scaled = container.querySelector<HTMLElement>(
      '[data-slot="page-miniature-scaled"]'
    );

    expect(scaled?.style.transform).toBe("scale(1)");
  });
});
