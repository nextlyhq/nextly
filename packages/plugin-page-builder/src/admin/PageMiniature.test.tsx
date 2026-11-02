/**
 * @vitest-environment jsdom
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/*
 * jsdom lays nothing out, so the sizes the preview reads are stubbed on the
 * elements it reads them from, by their slot. A stub keyed by slot rather than
 * set on every element keeps a measurement of the WRONG element at zero, which
 * is what lets these cases tell the right reading from a plausible wrong one.
 */
function stubLayout(sizes: {
  frameWidth: number;
  pageHeight: number;
  boxes?: Record<
    string,
    { top: number; height: number; left?: number; width?: number }
  >;
  /** Where the page's own box starts on screen. */
  pageTop?: number;
}): () => void {
  const width = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth"
  );
  const height = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight"
  );
  const rect = Element.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === "page-miniature" ? sizes.frameWidth : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === "page-miniature-scaled"
        ? sizes.pageHeight
        : 0;
    },
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = sizes.boxes?.[this.getAttribute("data-nx-node") ?? ""];
    const isPage =
      this instanceof HTMLElement &&
      this.dataset.slot === "page-miniature-page";
    const top = box?.top ?? (isPage ? (sizes.pageTop ?? 0) : 0);
    const h = box?.height ?? 0;
    const left = box?.left ?? 0;
    const w = box?.width ?? 100;
    return {
      top,
      bottom: top + h,
      left,
      right: left + w,
      width: w,
      height: h,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  };
  return () => {
    if (width)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    if (height)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
    Element.prototype.getBoundingClientRect = rect;
  };
}

function frameOf(container: HTMLElement): HTMLElement {
  const frame = container.querySelector<HTMLElement>(
    '[data-slot="page-miniature"]'
  );
  if (!frame) throw new Error("no preview frame");
  return frame;
}

describe("PageMiniature's height", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("shows at most 640 px of a long page and scrolls inside for the rest", () => {
    // 640 px of column for a 1280 px composition is a scale of one half, so a
    // 2000 px page is 1000 px tall on screen: more than the cap.
    restore = stubLayout({ frameWidth: 640, pageHeight: 2000 });
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
    );

    const frame = frameOf(container);
    expect(frame.style.height).toBe("640px");
    expect(frame.className).toContain("overflow-y-auto");
    // The scrolled content is the page's whole scaled height, so the rest of
    // it is reachable by scrolling rather than cut off.
    expect(
      container.querySelector<HTMLElement>('[data-slot="page-miniature-page"]')
        ?.style.height
    ).toBe("1000px");
  });

  it("is as tall as a short page, not the cap", () => {
    restore = stubLayout({ frameWidth: 640, pageHeight: 800 });
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
    );

    expect(frameOf(container).style.height).toBe("400px");
  });
});

describe("PageMiniature drawing only once it is seen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** An observer the test reports through, as a scroll would. */
  function observeBy(): { show: () => void } {
    let report: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
        observe(): void {}
        disconnect(): void {}
      }
    );
    return {
      show: () =>
        act(() =>
          report(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
          )
        ),
    };
  }

  it("does not draw the page while the field is off screen", () => {
    observeBy();
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
    );

    expect(container.textContent).not.toContain("Hello from the page");
    // The frame still holds its place, so the form does not jump when the page
    // arrives.
    expect(frameOf(container)).toBeDefined();
  });

  it("draws it once the field scrolls into view", () => {
    const observer = observeBy();
    const { container } = render(
      <PageMiniature document={doc} siteStyles={undefined} render={RENDER} />
    );

    observer.show();

    expect(container.textContent).toContain("Hello from the page");
  });
});

describe("PageMiniature's sections", () => {
  let restore = () => {};
  afterEach(() => restore());

  const twoSections = {
    ...doc,
    nodes: [
      ...doc.nodes,
      {
        id: "b",
        type: TEXT.name,
        version: TEXT.version,
        props: { text: "Second" },
      },
    ],
  } as unknown as BlockDocument;

  const sections = [
    { id: "a", name: "Section 1, Text: Hello from the page", href: "/x?s=a" },
    { id: "b", name: "Section 2, Text: Second", href: "/x?s=b" },
  ];

  it("offers each section as a link named for it", () => {
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={() => {}}
      />
    );

    const second = screen.getByRole("link", {
      name: "Section 2, Text: Second",
    });
    expect(second.getAttribute("href")).toBe("/x?s=b");
  });

  it("places each over the section it names", () => {
    // Half scale; the second section starts 600 px down the composed page and
    // is 400 px tall, so on screen it starts at 300 and is 200 tall. Measured
    // against the page's own box, which starts 50 px down the screen, so a
    // reading taken against the window instead would be 50 px out.
    restore = stubLayout({
      frameWidth: 640,
      pageHeight: 1000,
      pageTop: 50,
      boxes: { a: { top: 50, height: 300 }, b: { top: 350, height: 200 } },
    });
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={() => {}}
      />
    );

    const second = screen.getByRole("link", { name: /Section 2/ });
    expect(second.style.top).toBe("300px");
    expect(second.style.height).toBe("200px");
  });

  it("gives a thin section a target at least 24 px tall, centred on it", () => {
    // A divider is a few pixels tall once scaled. A link that size cannot be
    // hit reliably by pointer or touch (WCAG 2.5.8 asks for 24 by 24).
    restore = stubLayout({
      frameWidth: 640,
      pageHeight: 1000,
      boxes: { a: { top: 0, height: 300 }, b: { top: 300, height: 4 } },
    });
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={() => {}}
      />
    );

    const thin = screen.getByRole("link", { name: /Section 2/ });
    expect(thin.style.height).toBe("24px");
    expect(thin.style.top).toBe("290px");
    // Above the neighbours it now overlaps, or their links cover it again.
    expect(thin.style.zIndex).toBe("1");
  });

  it("keeps a thin section's target inside the page at its top and bottom edges", () => {
    // Centred on a divider at the very top, half the grown target would sit
    // above the frame, where the frame clips it: a target shorter than 24 px
    // again. Half scale: the page is 500 px tall on screen.
    restore = stubLayout({
      frameWidth: 640,
      pageHeight: 1000,
      boxes: { a: { top: 0, height: 4 }, b: { top: 497, height: 3 } },
    });
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={() => {}}
      />
    );

    const top = screen.getByRole("link", { name: /Section 1/ });
    expect(top.style.top).toBe("0px");
    expect(top.style.height).toBe("24px");
    const bottom = screen.getByRole("link", { name: /Section 2/ });
    expect(bottom.style.top).toBe("476px");
    expect(bottom.style.height).toBe("24px");
  });

  it("gives a narrow section a target at least 24 px wide, inside the page", () => {
    // A block drawn a few pixels wide — an icon, a thin rule standing on end —
    // is as hard to hit across as a divider is down. Half scale: the page is
    // 640 px wide on screen, so one at its right edge grows leftward.
    restore = stubLayout({
      frameWidth: 640,
      pageHeight: 1000,
      boxes: {
        a: { top: 0, height: 100, left: 300, width: 4 },
        b: { top: 200, height: 100, left: 636, width: 4 },
      },
    });
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={() => {}}
      />
    );

    const middle = screen.getByRole("link", { name: /Section 1/ });
    expect(middle.style.width).toBe("24px");
    expect(middle.style.left).toBe("290px");
    const edge = screen.getByRole("link", { name: /Section 2/ });
    expect(edge.style.width).toBe("24px");
    expect(edge.style.left).toBe("616px");
  });

  it("covers every part of a section drawn as several, such as a placed component", () => {
    // One placed component drawn as two roots is one section: its link spans
    // both, from the first's top to the last's bottom and across their widths.
    restore = stubLayout({
      frameWidth: 640,
      pageHeight: 1000,
      boxes: {
        a: { top: 10, height: 100, left: 0, width: 300 },
        b: { top: 110, height: 50, left: 20, width: 400 },
      },
    });
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={[
          { id: "a", parts: ["a", "b"], name: "Section 1, Band", href: "/x" },
        ]}
        onNavigate={() => {}}
      />
    );

    const band = screen.getByRole("link", { name: "Section 1, Band" });
    expect([band.style.top, band.style.height]).toEqual(["10px", "150px"]);
    expect([band.style.left, band.style.width]).toEqual(["0px", "420px"]);
  });

  it("opens a section within the admin on a plain click, and on Space", () => {
    const onNavigate = vi.fn();
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={onNavigate}
      />
    );
    const first = screen.getByRole("link", { name: /Section 1/ });

    fireEvent.click(first, { button: 0 });
    fireEvent.keyDown(first, { key: " " });

    expect(onNavigate.mock.calls).toEqual([["/x?s=a"], ["/x?s=a"]]);
  });

  it("leaves a modified click to the browser, which opens a new tab", () => {
    const onNavigate = vi.fn();
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
        sections={sections}
        onNavigate={onNavigate}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: /Section 1/ }), {
      button: 0,
      metaKey: true,
    });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("offers nothing to open when it is given no sections", () => {
    render(
      <PageMiniature
        document={twoSections}
        siteStyles={undefined}
        render={RENDER}
      />
    );

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
