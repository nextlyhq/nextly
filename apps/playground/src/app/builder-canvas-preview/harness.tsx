"use client";

import {
  previewContainerFor,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { Canvas, useEditorState } from "@nextlyhq/builder/shell";
import { useMemo, useState } from "react";

import { useCoreBlocks } from "@/lib/use-core-blocks";

import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

const HARNESS_SOURCE = "e2e-canvas-preview-harness";

/** The tier the fixture narrows into, and the width that is inside it. */
const TIER_BOUND = 600;

/**
 * Two colours that cannot be confused for one another, or for a default.
 *
 * A test asserting a computed colour needs values no stylesheet elsewhere
 * produces: `rgb(0, 0, 255)` at the base tier and `rgb(255, 0, 0)` below the
 * bound. Equal values, or values a reset might land on, would let a canvas
 * applying neither rule satisfy the assertion.
 */
const BASE_COLOUR = "#0000ff";
const TIER_COLOUR = "#ff0000";

const BREAKPOINTS = {
  viewport: [{ id: "narrow", label: "Narrow", maxWidth: TIER_BOUND }],
  container: [],
};

function previewDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "subject",
        type: "core/text",
        version: 1,
        props: { text: "subject" },
        styles: {
          base: {
            base: { color: BASE_COLOUR },
            narrow: { color: TIER_COLOUR },
          },
        },
      },
    ],
  };
}

/**
 * The canvas previewing, mounted for real, so a browser can decide the queries.
 *
 * SEPARATE from `/builder-canvas`, whose fixture states that it "asserts nothing
 * responsive, and a breakpoint here would make the canvas's own width one more
 * thing a drop coordinate depends on". Adding a tier to that route would put a
 * width-sensitive rule underneath twenty-odd pointer tests measuring rectangles.
 *
 * What is ONLY observable here: that narrowing the box changes which declaration
 * WINS. Every unit test of this feature asserts the sheet says the right thing
 * and the element carries the right container name — but jsdom ships no `CSS`
 * object and evaluates no container query, so a sheet that is correct and a box
 * that establishes nothing produce identical green. The claim the whole compile
 * exists to support is that resizing the box moves the breakpoint, and a browser
 * is the only thing that can answer it.
 *
 * The width is driven by a control rather than by resizing the viewport, because
 * the viewport is exactly what a container query must NOT answer to: a test that
 * moved the window would pass against a canvas still compiling `@media`, which
 * is the bug this mechanism was built to remove.
 */
export function BuilderCanvasPreviewHarness() {
  useCoreBlocks(HARNESS_SOURCE);

  const initialDocument = useMemo(() => previewDocument(), []);
  const editor = useEditorState({ initialDocument });
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [measured, setMeasured] = useState<number | undefined>(undefined);

  const container = useMemo(
    () => previewContainerFor("e2e-canvas-preview"),
    []
  );
  const siteStyles = useMemo(() => ({ breakpoints: BREAKPOINTS }), []);
  const render = useMemo(
    () => ({ styleContext: { breakpoints: BREAKPOINTS } }),
    []
  );
  const preview = useMemo(
    () => ({
      container,
      ...(width === undefined ? {} : { width }),
      onMeasured: setMeasured,
    }),
    [container, width]
  );

  return (
    <div data-testid="canvas-preview-harness" style={{ height: "100vh" }}>
      {/*
        The width is SET, never typed as a pixel value the test computes: the
        two buttons name the states the fixture is about, so a spec cannot
        accidentally ask for a width on the boundary and depend on whether the
        query is inclusive.
      */}
      <button
        type="button"
        data-testid="go-narrow"
        onClick={() => setWidth(TIER_BOUND)}
      >
        narrow
      </button>
      <button
        type="button"
        data-testid="go-wide"
        onClick={() => setWidth(undefined)}
      >
        wide
      </button>
      {/*
        What the box actually MEASURED, reported so the spec can wait on the
        canvas having observed its own resize rather than on a timeout. The
        request is a ceiling and the measurement is what the queries resolve
        against, so this is the number the assertion below is really about.
      */}
      <output data-testid="measured">{measured ?? ""}</output>
      <Canvas
        document={editor.document}
        siteStyles={siteStyles}
        render={render}
        preview={preview}
        selectedId={editor.selectedId}
        onSelect={editor.select}
      />
    </div>
  );
}
