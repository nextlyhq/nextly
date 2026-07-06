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
import { Button } from "@nextlyhq/ui";

import { defaultBlockRegistry } from "../core/registry";

import { Canvas } from "./canvas/Canvas";
import { dragLabel } from "./logic/dragLabel";
import { planDrop } from "./logic/dropPlan";
import { BlockLibrary } from "./panels/BlockLibrary";
import { Inspector } from "./panels/Inspector";
import { useEditor } from "./store/EditorProvider";

const BREAKPOINTS = ["base", "tablet", "mobile"];

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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "70vh",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: 8,
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          {BREAKPOINTS.map(bp => (
            <Button
              key={bp}
              variant={state.activeBreakpoint === bp ? "default" : "outline"}
              onClick={() =>
                dispatch({ type: "SET_BREAKPOINT", breakpoint: bp })
              }
            >
              {bp}
            </Button>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "200px 1fr 300px",
            flex: 1,
            minHeight: 0,
          }}
        >
          <aside
            style={{
              borderRight: "1px solid #e5e7eb",
              padding: 8,
              overflow: "auto",
            }}
          >
            <BlockLibrary />
          </aside>
          <main style={{ minHeight: 0 }}>
            <Canvas />
          </main>
          <aside
            style={{
              borderLeft: "1px solid #e5e7eb",
              overflow: "auto",
            }}
          >
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
              borderRadius: 8,
              background: "#4338ca",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 8px 24px rgba(67,56,202,0.35)",
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
