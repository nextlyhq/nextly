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
import { type LucideIcon } from "lucide-react";
import { useState } from "react";

import { defaultBlockRegistry } from "../core/registry";

import { Canvas } from "./canvas/Canvas";
import { Monitor, Smartphone, Tablet } from "./icons";
import { InvalidSlotBanner } from "./InvalidSlotBanner";
import { dragLabel } from "./logic/dragLabel";
import { planDrop, type DropOutcome, type DropRefusal } from "./logic/dropPlan";
import { dropRefusalMessage } from "./logic/dropRefusal";
import { BlockLibrary } from "./panels/BlockLibrary";
import { Inspector } from "./panels/Inspector";
import { useEditor } from "./store/EditorProvider";

const BREAKPOINTS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "base", label: "Desktop", Icon: Monitor },
  { id: "tablet", label: "Tablet", Icon: Tablet },
  { id: "mobile", label: "Mobile", Icon: Smartphone },
];

/** The source and target a drag event carries, which is all either handler below reads. */
interface DragOperation {
  source: { id: string | number; data?: unknown } | null;
  target: { id: string | number; data?: unknown } | null;
}

export function EditorSurface() {
  const { state, dispatch } = useEditor();
  const root = state.document.root;
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
    <DragDropProvider onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="nx-pb-editor">
        <div className="nx-pb-toolbar">
          <div className="nx-pb-seg" role="group" aria-label="Preview device">
            {BREAKPOINTS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className="nx-pb-seg-btn"
                aria-pressed={state.activeBreakpoint === id}
                aria-label={label}
                onClick={() =>
                  dispatch({ type: "SET_BREAKPOINT", breakpoint: id })
                }
              >
                <Icon size={15} aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
        {/*
         * Above the panes rather than inside the canvas column: the blocks it reports are not
         * drawn on the canvas at all, so anchoring the notice to the canvas would put it beside
         * the one place that cannot show what it is about.
         */}
        <InvalidSlotBanner />
        <div className="nx-pb-body">
          <aside className="nx-pb-pane nx-pb-pane--left">
            <BlockLibrary />
          </aside>
          {/*
           * A region, not a second `main`. HTML allows one non-hidden `main` per
           * document and the admin already renders it, so a nested one is invalid
           * markup, gives assistive technology two competing primary landmarks,
           * and makes every strict `main` locator in the e2e suite ambiguous. The
           * label is what keeps it a useful landmark rather than a bare wrapper.
           */}
          <section className="nx-pb-pane--center" aria-label="Canvas">
            <Canvas />
          </section>
          <aside className="nx-pb-pane nx-pb-pane--right">
            <Inspector />
          </aside>
        </div>
      </div>

      <DragOverlay>
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
                boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
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
                      alignItems: "baseline",
                      gap: 6,
                      maxWidth: 260,
                      padding: "5px 10px",
                      borderRadius: "var(--radius)",
                      border: "2px solid var(--nx-destructive)",
                      background: "var(--nx-background)",
                      color: "var(--nx-foreground)",
                      fontSize: 12,
                      fontWeight: 500,
                      boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
                    }
                  : undefined
              }
            >
              {refusal ? (
                <>
                  <span aria-hidden style={{ color: "var(--nx-destructive)" }}>
                    ⃠
                  </span>
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
