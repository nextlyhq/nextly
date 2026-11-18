// @vitest-environment jsdom

/**
 * The page's placeholder on the canvas, for a document view with no page of
 * its own: drawn between the header and the footer, only when asked for, and
 * a press on it is a press on the page's ground.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Canvas } from "./canvas";
import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import type { CanvasRegion } from "./canvas-regions";
import { PAGE_PLACEHOLDER_ATTRIBUTE } from "./page-placeholder";

afterEach(cleanup);

beforeAll(() => {
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { text?: string };
        }) => createElement("p", { className }, props.text),
      },
    ] as never,
    { source: "page-placeholder-test" }
  );
});

afterAll(clearBlocks);

const EMPTY: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [],
} as BlockDocument;

function regionOf(area: "header" | "footer", text: string): CanvasRegion {
  const componentId = `${area}-component`;
  return {
    area,
    document: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: `nextly-region-${area}`,
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId },
        },
      ],
    } as BlockDocument,
    definitions: new Map([
      [
        componentId,
        {
          formatVersion: 1,
          kind: "component",
          nodes: [{ id: "t", type: "acme/text", version: 1, props: { text } }],
        } as unknown as BlockDocument,
      ],
    ]),
    label: area === "header" ? "Site header" : "Site footer",
    badge: area,
    name: area,
  };
}

const sheet = { breakpoints: { viewport: [], container: [] } };

function renderCanvas(placeholder: string | undefined, onSelect = vi.fn()) {
  render(
    <Canvas
      document={EMPTY}
      siteStyles={sheet as never}
      regions={[regionOf("header", "Top"), regionOf("footer", "Bottom")]}
      onSelect={onSelect}
      render={{ styleContext: sheet } as never}
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  );
  return onSelect;
}

describe("the page's placeholder", () => {
  it("is drawn between the header and the footer, saying its words", () => {
    renderCanvas("Page content goes here");
    const text = document.body.textContent ?? "";
    const words = text.indexOf("Page content goes here");
    expect(words).toBeGreaterThan(text.indexOf("Top"));
    expect(words).toBeLessThan(text.indexOf("Bottom"));
  });

  it("is not drawn unless asked for", () => {
    renderCanvas(undefined);
    expect(
      document.querySelector(`[${PAGE_PLACEHOLDER_ATTRIBUTE}]`)
    ).toBeNull();
  });

  it("is the page's ground: a press on it clears the selection", () => {
    const onSelect = renderCanvas("Page content goes here");
    fireEvent.click(screen.getByText("Page content goes here"));
    expect(onSelect).toHaveBeenCalledWith(null, "replace");
  });

  it("is styled by the frame's own sheet, in the page's ink", () => {
    const at = CANVAS_FRAME_SHEET.indexOf(`[${PAGE_PLACEHOLDER_ATTRIBUTE}] {`);
    expect(at).toBeGreaterThan(-1);
    expect(CANVAS_FRAME_SHEET.slice(at, at + 600)).toContain("currentColor");
  });
});
