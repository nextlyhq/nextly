/**
 * @vitest-environment jsdom
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageMiniature } from "./PageMiniature";
import { pageRenderInputs } from "./page-render-inputs";

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

/*
 * Built through the real derivation rather than as a literal, so this fixture
 * cannot describe a bundle the product never produces.
 */
const RENDER = pageRenderInputs({
  siteStyle: undefined,
  clientConfig: undefined,
  previewContainer: undefined,
  limits: DEFAULT_LIMITS,
});

describe("PageMiniature", () => {
  it("draws the document's own content", () => {
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
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
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
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
      <PageMiniature
        document={doc}
        siteStyles={undefined}
        render={RENDER}
        renderWidth={1280}
      />
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
   * `inert` does not prevent a resource load, so the policy has to reach the
   * renderer: without it remote fetching defaults OPEN and the miniature can
   * request an image or an iframe from a host the published page refuses.
   */
  it("carries the site's remote-host policy to the renderer", () => {
    const render_ = pageRenderInputs({
      siteStyle: undefined,
      clientConfig: { remotePatterns: [{ hostname: "cdn.example" }] },
      previewContainer: undefined,
      limits: DEFAULT_LIMITS,
    });

    expect(render_.hostPolicy?.remotePatterns).toEqual([
      { hostname: "cdn.example" },
    ]);
  });

  /*
   * The container has to be declared on the element whose width the compiled
   * rules must answer for — the COMPOSED width, not the clipped frame's. A
   * named container left at the default `container-type: normal` is not a
   * size-query container, so every rule the compile emitted stays inert.
   */
  it("declares the compiled container on the composed box", () => {
    const withContainer = pageRenderInputs({
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 1024 }],
          container: [],
        },
      } as never,
      clientConfig: undefined,
      previewContainer: "nx-preview-mini",
      limits: DEFAULT_LIMITS,
    });

    const { container } = render(
      <PageMiniature
        document={doc}
        siteStyles={undefined}
        render={withContainer}
      />
    );
    const scaled = container.querySelector<HTMLElement>(
      '[data-slot="page-miniature-scaled"]'
    );

    expect(scaled?.style.containerName).toBe("nx-preview-mini");
    expect(scaled?.style.containerType).toBe("inline-size");
  });

  /*
   * The entry screen is a `<form>`, so a page holding a form block puts one
   * form inside another. The live consequence in this rendering path is a
   * submit from the previewed page reaching the form that saves the entry.
   *
   * Asserted through a REAL submit event on a real form rendered by the real
   * block, rather than by checking that a handler was passed: a prop can be
   * present and still not stop anything.
   */
  it("refuses a submit raised inside the page", () => {
    const FORM = coreBlocks.find(block => block.name === "core/form");
    if (!FORM) throw new Error("core/form is missing from coreBlocks");

    const withForm = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "f",
          type: FORM.name,
          version: FORM.version,
          props: { method: "post", submitText: "Send", fields: [] },
        },
      ],
    } as unknown as BlockDocument;

    const { container } = render(
      <PageMiniature
        document={withForm}
        siteStyles={undefined}
        render={RENDER}
      />
    );

    const form = container.querySelector("form");
    // The control: if the page drew no form, the assertion below would pass
    // against nothing at all.
    expect(form).not.toBeNull();

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form?.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(true);
  });

  /*
   * The property that makes the scale correct, and the one jsdom can still see.
   *
   * `transform` removes an element from painting and leaves it in LAYOUT, so a
   * statically positioned child declared at the compose width stretches its
   * ancestors to that width — measured in a browser, the frame's `clientWidth`
   * came back as the compose width rather than the column's, the scale computed
   * from it was 1, and the page drew full-size and overflowed the form. There
   * is no layout here to reproduce that, so this asserts the structural cause
   * instead: out of flow, anchored to the frame's origin.
   */
  it("takes the scaled page out of the layout flow", () => {
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
    );
    const scaled = container.querySelector<HTMLElement>(
      '[data-slot="page-miniature-scaled"]'
    );

    expect(scaled?.className).toContain("absolute");
  });

  /*
   * jsdom reports every element as zero-width, which is the same reading a
   * container genuinely gives before layout. Scaling by the measured ratio
   * there would multiply the page by zero and draw nothing at all, so an
   * unmeasurable container renders unscaled rather than blank.
   */
  it("renders unscaled while the container cannot be measured", () => {
    const { container } = render(
      <PageMiniature
        document={doc}
        siteStyles={undefined}
        render={RENDER}
        renderWidth={1280}
      />
    );
    const scaled = container.querySelector<HTMLElement>(
      '[data-slot="page-miniature-scaled"]'
    );

    expect(scaled?.style.transform).toBe("scale(1)");
  });
});
