"use client";

import { registryNestingSource } from "@nextlyhq/blocks-engine";
import { registrySlotSource } from "@nextlyhq/builder";
import {
  Canvas,
  CanvasFrame,
  CanvasFrameProvider,
  CanvasMarks,
  DropIndicator,
  DropRefusal,
  SpacingOverlay,
  useCanvasDrag,
  useEditorState,
} from "@nextlyhq/builder/shell";
import { useEffect, useMemo, useRef, useState } from "react";

// The design system's sheet FIRST, then the editor's, which supplements it —
// the same order and the same reason as the shell harness: the editor's sheet
// ships neither the `--nx-*` tokens nor the base reset, because the host owns
// both and a second copy would make the result depend on which one won.
import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

import { useCoreBlocks } from "@/lib/use-core-blocks";

import { canvasHarnessDocument } from "./seed";

const HARNESS_SOURCE = "e2e-canvas-harness";

/** The frame drawn at its own size, never fitted. */
const ACTUAL_SIZE = { kind: "fixed", scale: 1 } as const;

/**
 * The canvas, mounted for real, so a browser can drive it.
 *
 * SEPARATE from the shell harness on purpose. That route's slots are inert by
 * decision — its own docblock says "anything interactive here would be testing
 * the harness rather than the shell" — and its twenty-seven passing tests
 * measure the shell's geometry against markers. Mounting a live canvas into it
 * would put a moving, scrolling, drag-handling surface inside the box those
 * tests measure, so the two harnesses would share a failure mode with nothing
 * naming which one broke.
 *
 * So the shell keeps its markers and this route mounts the real thing: `Canvas`
 * with `useCanvasDrag`, over a document with the neighbours the drop rules
 * actually turn on. No shell chrome at all — the rail, panels and top bar are
 * the shell's subject, not the canvas's, and a canvas that fills the viewport
 * is the one a pointer test can reach every edge of.
 *
 * What this harness must NOT do is compute anything the canvas computes. It
 * seeds a document and renders the editor's own components; every threshold,
 * every drop decision and every indicator position comes from the engine under
 * test. A harness that positioned its own indicator would certify itself.
 */
export function BuilderCanvasHarness() {
  // The frame provided ABOVE the drag, as the editor provides it: the drag
  // listens and scrolls in the document the frame registers here.
  return (
    <CanvasFrameProvider>
      <HarnessBody />
    </CanvasFrameProvider>
  );
}

function HarnessBody() {
  useCoreBlocks(HARNESS_SOURCE);

  const initialDocument = useMemo(() => canvasHarnessDocument(), []);
  const editor = useEditorState({ initialDocument });

  /*
   * Both drop questions answered by the SAME registry the inserter reads, which
   * is the production wiring rather than a harness shortcut. Given separate
   * sources, a container the palette would insert into and a container a drag
   * may aim at could disagree — and a suite built on the disagreement would
   * certify the wrong rule.
   */
  const slots = useMemo(() => registrySlotSource(), []);
  const nesting = useMemo(() => registryNestingSource(), []);
  const drag = useCanvasDrag({ editor, slots, nesting });

  /*
   * The site sheet the published route passes. Empty breakpoint sets: this
   * fixture asserts nothing responsive, and a breakpoint here would make the
   * canvas's own width one more thing a drop coordinate depends on.
   */
  const siteStyles = useMemo(
    () => ({ breakpoints: { viewport: [], container: [] } }),
    []
  );

  /*
   * The frame is laid out at the window's own size and drawn at 100%, so the
   * page fills the viewport, a pointer test can reach every edge of it, and a
   * block's position on screen is its position in the frame. The frame's
   * viewport scrolls the page, which is what autoscroll is tested against.
   */
  const host = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null
  );
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const read = (): void =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={host}
      data-testid="canvas-harness"
      style={{ height: "100vh", overflow: "hidden" }}
      /*
       * Reported rather than asserted here: the drag's live state, so a test can
       * read what the ENGINE decided instead of inferring it from pixels. A
       * property about which target is active is otherwise only observable
       * through the indicator's position, which is a second derivation of the
       * same fact and fails for a different reason than the rule it stands in
       * for.
       */
      data-nx-dragging={drag.draggingId ?? ""}
      data-nx-drop-target={drag.target ? JSON.stringify(drag.target) : ""}
      /*
       * The editor's own undo depth, so "one drop is one undo entry" is asked
       * of the OP STORE rather than inferred from the tree. A suite counting
       * document changes instead would pass for a drop that recorded two ops
       * whose net effect happened to look like one.
       */
      data-nx-undo-depth={editor.undoDepth}
    >
      {size === null ? null : (
        <CanvasFrame
          width={size.width}
          height={size.height}
          zoom={ACTUAL_SIZE}
          title="Canvas harness"
          /*
           * The chrome, drawn over the frame as the editor draws it. The
           * spacing bands are measurable only where the canvas is laid out for
           * real: jsdom reports every element as zero-sized, so the geometry
           * this draws has no other place it can be certified.
           */
          overlay={
            <>
              <CanvasMarks />
              <DropIndicator target={drag.target} />
              <DropRefusal drag={drag} document={editor.document} />
              <SpacingOverlay
                editor={editor}
                hidden={drag.draggingId !== null}
              />
            </>
          }
        >
          <Canvas
            document={editor.document}
            siteStyles={siteStyles}
            // Mirrors what `BlocksField` passes. The per-node style tier
            // compiles only when the renderer is given a style context, and
            // without it the canvas draws every block flush and unstyled while
            // the published page draws the author's real spacing — so a
            // harness omitting it would certify a canvas nobody ships.
            render={{
              styleContext: { breakpoints: { viewport: [], container: [] } },
            }}
            selectedId={editor.selectedId}
            selectedIds={editor.selection.ids}
            onSelect={editor.select}
            dragHandlers={drag.handlers}
            drag={drag}
          />
        </CanvasFrame>
      )}
    </div>
  );
}
