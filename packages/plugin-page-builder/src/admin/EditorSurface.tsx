"use client";

/**
 * The 3-pane editor surface (spec §9): left block library | center iframe canvas | right
 * inspector, with a breakpoint switcher. A single DragDropProvider spans all panes so a
 * library source can drop into the canvas and canvas nodes can reorder; between-item drop
 * zones show exactly where a block lands, and a DragOverlay chip follows the cursor. Drops
 * are planned by the pure `planDrop`. Keyboard users add via the library's Insert buttons
 * and reorder via the inspector — no pointer required.
 */
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { BuilderShell } from "@nextlyhq/builder/shell";
import { useState } from "react";

import { defaultBlockRegistry } from "../core/registry";

import { BreakpointControl } from "./BreakpointControl";
import { Canvas } from "./canvas/Canvas";
import { editorPreferenceStore } from "./editorPreferences";
import { Ban } from "./icons";
import { InvalidSlotBanner } from "./InvalidSlotBanner";
import { dragLabel } from "./logic/dragLabel";
import { planDrop, type DropOutcome, type DropRefusal } from "./logic/dropPlan";
import { dropRefusalMessage } from "./logic/dropRefusal";
import { BlockLibrary } from "./panels/BlockLibrary";
import { Inspector } from "./panels/Inspector";
import { useEditor } from "./store/EditorProvider";

/** The source and target a drag event carries, which is all either handler below reads. */
interface DragOperation {
  source: { id: string | number; data?: unknown } | null;
  target: { id: string | number; data?: unknown } | null;
}

/**
 * The rail panels this editor can currently fill.
 *
 * The shell draws all seven and disables the rest, so the rail keeps describing
 * the editor's eventual shape without offering a control that opens an empty
 * region. Extend this as the layers panel, inserter and entry panel land — it is
 * the one place that decides, so the rail cannot disagree with `renderPanel`.
 */
const FILLED_PANELS = ["insert"] as const;

export interface EditorSurfaceProps {
  /**
   * Which editor surface this is, for scoping chrome preferences.
   *
   * A form may embed several page-builder fields; without this they share one set
   * of panel widths and silently drive each other. Pass the same identifier used
   * as the provider's draft key, so the two cannot disagree.
   */
  surface?: string;
  /**
   * Leaving the editor, when the host has somewhere to go.
   *
   * Omitted by the FIELD mount, which renders inside an entry form: the author is
   * already on the page an exit would return them to, so the shell renders no exit
   * affordance at all rather than an inert one.
   */
  onExit?: () => void;
}

export function EditorSurface({ onExit, surface }: EditorSurfaceProps = {}) {
  const { state, dispatch } = useEditor();
  const root = state.document.root;
  /**
   * Created once. The shell reloads preferences whenever this identity changes, so a
   * new object every render would reset the author's panel choices on each keystroke.
   */
  const [preferences] = useState(() => editorPreferenceStore(surface));
  /**
   * Why the CURRENT target refuses this block, while the drag is still in the air.
   *
   * Held here rather than derived at render: the overlay renders on every pointer move and
   * planning is a tree walk, so it is computed when the target CHANGES — which is exactly when
   * `dragover` fires.
   */
  const [refusal, setRefusal] = useState<DropRefusal | null>(null);

  const outcomeOf = (operation: DragOperation): DropOutcome => {
    const { source, target } = operation;
    if (!source || !target) return { kind: "unresolved" };
    return planDrop(
      source.data ?? {},
      target.data ?? {},
      root,
      defaultBlockRegistry
    );
  };

  /**
   * Feedback lands DURING the drag, not on release. A refusal the author only discovers after
   * letting go is the failure this is here to remove: they aim at a container, nothing happens,
   * and nothing says why.
   */
  const onDragOver = (event: { operation: DragOperation }) => {
    const outcome = outcomeOf(event.operation);
    setRefusal(outcome.kind === "refused" ? outcome.reason : null);
  };

  /**
   * The first target needs its own read, because `dragover` cannot report it.
   *
   * `setDropTarget` returns early when the identifier is unchanged, and dispatches only once the
   * operation is already `dragging`. A target resolved while the drag is still initialising
   * therefore sets the identifier WITHOUT emitting — and every later resolution of that same
   * target takes the early return. So a drag that begins over a refusing container would say
   * nothing until the pointer left and came back, which is exactly the case a node dragged inside
   * its own formatted parent hits first.
   */
  const onDragStart = (event: { operation: DragOperation }) => {
    const outcome = outcomeOf(event.operation);
    setRefusal(outcome.kind === "refused" ? outcome.reason : null);
  };

  const onDragEnd = (event: {
    operation: DragOperation;
    canceled: boolean;
  }) => {
    // Cleared on EVERY end, cancels included: the overlay unmounts but this state does not, and a
    // refusal left behind would be the message shown at the start of the next drag.
    setRefusal(null);
    if (event.canceled) return;
    const outcome = outcomeOf(event.operation);
    if (outcome.kind === "action") dispatch(outcome.action);
  };

  return (
    <DragDropProvider
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="nx-pb-editor">
        {/*
         * Above the shell rather than inside the canvas slot: the blocks it reports are not
         * drawn on the canvas at all, so anchoring the notice to the canvas would put it beside
         * the one place that cannot show what it is about. The shell offers no full-width notice
         * slot, and the top bar is for controls, so it stays a sibling.
         */}
        <InvalidSlotBanner />
        {/*
         * The shell supplies the chrome this file used to hand-roll: the rail, the switched
         * panel, the inspector column and the bars. What it never does is look inside the
         * canvas — its `children` docblock says so — which is why the drag provider and the
         * overlay below can stay exactly where they were.
         *
         * `min-h-0` because the shell is `h-full` inside a flex column: without it the canvas
         * grows to its content and the whole editor scrolls instead of the canvas.
         */}
        <BuilderShell
          className="min-h-0 flex-1"
          store={preferences}
          topBar={<BreakpointControl />}
          availablePanels={FILLED_PANELS}
          renderPanel={panel => (panel === "insert" ? <BlockLibrary /> : null)}
          inspector={<Inspector />}
          onExit={onExit}
        >
          <Canvas />
        </BuilderShell>
      </div>

      {/*
       * Named, because everything inside it is an anonymous inline-styled div otherwise. The chip
       * and the refusal below it are the editor's only feedback during a drag, and neither the
       * stylesheet nor anything reading the surface has a handle on them without a class on the
       * element dnd-kit positions.
       */}
      <DragOverlay className="nx-pb-drag-overlay">
        {source => (
          <div
            data-refused={refusal ? "true" : undefined}
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 4,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: "var(--radius)",
                background: "var(--nx-primary)",
                color: "var(--nx-primary-foreground)",
                fontSize: 13,
                fontWeight: 600,
                boxShadow:
                  "0 8px 24px color-mix(in srgb, var(--nx-shadow-color) 25%, transparent)",
                whiteSpace: "nowrap",
              }}
            >
              <span aria-hidden>⠿</span>
              {dragLabel(source?.data ?? {}, root, defaultBlockRegistry)}
            </span>
            {/*
             * Mounted for the WHOLE drag and only its text changes. A polite live region that
             * enters the accessibility tree already carrying its first message is not reliably
             * announced, so a region created at the moment of refusal can stay silent for the one
             * case it exists to speak for. Empty, it renders nothing and occupies no space.
             *
             * Polite rather than assertive: this text changes on every target the pointer crosses,
             * and an assertive region would interrupt on each one.
             */}
            <span
              role="status"
              aria-live="polite"
              style={
                refusal
                  ? {
                      // The explanation is normal-weight body text, so it needs the 4.5:1 text
                      // ratio rather than the 3:1 allowed for UI boundaries. Painting it on the
                      // destructive FILL cannot reach that: measured through the repository's own
                      // resolver, `--nx-destructive-foreground` on `--nx-destructive` is 3.84:1 in
                      // light mode. It sits on the page surface instead, where
                      // `--nx-foreground` on `--nx-background` measures 20.41:1 light and 21:1
                      // dark — a pairing the contrast suite already asserts.
                      //
                      // Refusal is then carried by the border, the mark and the words rather than
                      // by a fill. `--nx-destructive` on `--nx-background` measures 3.73:1 light
                      // and 6.90:1 dark, clearing the 3:1 a non-text boundary needs in both modes,
                      // and the sentence says which rule applied where no colour could.
                      display: "inline-flex",
                      // Centred rather than on the baseline: an SVG's baseline is its bottom edge,
                      // so a baseline-aligned icon rides above the text it sits beside.
                      alignItems: "center",
                      gap: 6,
                      maxWidth: 260,
                      padding: "5px 10px",
                      borderRadius: "var(--radius)",
                      border: "2px solid var(--nx-destructive)",
                      background: "var(--nx-background)",
                      color: "var(--nx-foreground)",
                      fontSize: 12,
                      fontWeight: 500,
                      boxShadow:
                        "0 8px 24px color-mix(in srgb, var(--nx-shadow-color) 25%, transparent)",
                    }
                  : undefined
              }
            >
              {refusal ? (
                <>
                  {/*
                   * An icon rather than a character. The obvious glyph for this is U+20E0
                   * COMBINING ENCLOSING CIRCLE BACKSLASH, which is an enclosing MARK: it has no
                   * form of its own and needs a base character to enclose, so standing alone it
                   * draws a dotted-circle placeholder or nothing at all depending on the font.
                   * A component renders the same everywhere and contributes no text to the live
                   * region beside it.
                   */}
                  <Ban
                    size={13}
                    aria-hidden
                    style={{ color: "var(--nx-destructive)", flexShrink: 0 }}
                  />
                  {dropRefusalMessage(refusal)}
                </>
              ) : null}
            </span>
          </div>
        )}
      </DragOverlay>
    </DragDropProvider>
  );
}
