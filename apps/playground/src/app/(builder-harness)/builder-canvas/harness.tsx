"use client";

import { registryNestingSource } from "@nextlyhq/blocks-engine";
import { registrySlotSource } from "@nextlyhq/builder";
import {
  Canvas,
  DropIndicator,
  SpacingOverlay,
  useCanvasDrag,
  useEditorState,
} from "@nextlyhq/builder/shell";
import { useMemo } from "react";

// The design system's sheet FIRST, then the editor's, which supplements it —
// the same order and the same reason as the shell harness: the editor's sheet
// ships neither the `--nx-*` tokens nor the base reset, because the host owns
// both and a second copy would make the result depend on which one won.
import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

import { useCoreBlocks } from "@/lib/use-core-blocks";

import { canvasHarnessDocument } from "./seed";

const HARNESS_SOURCE = "e2e-canvas-harness";

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

  return (
    <div
      data-testid="canvas-harness"
      /*
       * A fixed, non-viewport height with its own scroll, because autoscroll is
       * one of the properties under test and it engages on the canvas's
       * scrollable box. A canvas sized to the window would make the test depend
       * on the browser's own scrolling instead.
       */
      style={{ height: "100vh", overflow: "auto" }}
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
      <Canvas
        document={editor.document}
        siteStyles={siteStyles}
        // Mirrors what `BlocksField` passes. The per-node style tier compiles
        // only when the renderer is given a style context, and without it the
        // canvas draws every block flush and unstyled while the published page
        // draws the author's real spacing — so a harness omitting it would
        // certify a canvas nobody ships.
        render={{
          styleContext: { breakpoints: { viewport: [], container: [] } },
        }}
        selectedId={editor.selectedId}
        selectedIds={editor.selection.ids}
        onSelect={editor.select}
        dragHandlers={drag.handlers}
        /*
         * Both overlays, because the spacing bands are only measurable where the
         * canvas is laid out for real. jsdom reports every element as zero-sized,
         * so the geometry this draws has no other place it can be certified.
         */
        overlay={
          <>
            <DropIndicator target={drag.target} />
            <SpacingOverlay editor={editor} hidden={drag.draggingId !== null} />
          </>
        }
      />
    </div>
  );
}
