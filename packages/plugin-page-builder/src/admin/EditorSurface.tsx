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

import { defaultBlockRegistry } from "../core/registry";

import { Canvas } from "./canvas/Canvas";
import { Monitor, Smartphone, Tablet } from "./icons";
import { dragLabel } from "./logic/dragLabel";
import { planDrop } from "./logic/dropPlan";
import { BlockLibrary } from "./panels/BlockLibrary";
import { Inspector } from "./panels/Inspector";
import { useEditor } from "./store/EditorProvider";

const BREAKPOINTS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "base", label: "Desktop", Icon: Monitor },
  { id: "tablet", label: "Tablet", Icon: Tablet },
  { id: "mobile", label: "Mobile", Icon: Smartphone },
];

export function EditorSurface() {
  const { state, dispatch } = useEditor();
  const root = state.document.root;

  const onDragEnd = (event: {
    operation: {
      source: { id: string | number; data?: unknown } | null;
      target: { id: string | number; data?: unknown } | null;
    };
    canceled: boolean;
  }) => {
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return;
    const action = planDrop(
      source.data ?? {},
      target.data ?? {},
      root,
      defaultBlockRegistry
    );
    if (action) dispatch(action);
  };

  return (
    <DragDropProvider onDragEnd={onDragEnd}>
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
        <div className="nx-pb-body">
          <aside className="nx-pb-pane nx-pb-pane--left">
            <BlockLibrary />
          </aside>
          <main className="nx-pb-pane--center">
            <Canvas />
          </main>
          <aside className="nx-pb-pane nx-pb-pane--right">
            <Inspector />
          </aside>
        </div>
      </div>

      <DragOverlay>
        {source => (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: "var(--radius)",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden>⠿</span>
            {dragLabel(source?.data ?? {}, root, defaultBlockRegistry)}
          </div>
        )}
      </DragOverlay>
    </DragDropProvider>
  );
}
