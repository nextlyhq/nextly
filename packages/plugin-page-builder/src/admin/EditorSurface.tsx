"use client";

/**
 * The 3-pane editor surface (spec §9): left block library | center iframe canvas | right
 * inspector, with a breakpoint switcher. A single DragDropProvider spans all panes so a
 * library source can drop into the canvas and canvas nodes can reorder; drops are guarded
 * by the pure `canDrop` rule. Keyboard users add via the library's Insert buttons and
 * reorder via the inspector — no pointer required.
 */
import { DragDropProvider } from "@dnd-kit/react";
import { Button } from "@nextlyhq/ui";

import { defaultBlockRegistry } from "../core/registry";
import { findNode } from "../core/tree";

import { Canvas } from "./canvas/Canvas";
import { canDrop } from "./logic/dropRules";
import { BlockLibrary } from "./panels/BlockLibrary";
import { Inspector } from "./panels/Inspector";
import { useEditor } from "./store/EditorProvider";

const BREAKPOINTS = ["base", "tablet", "mobile"];

interface DragData {
  kind?: "library" | "node";
  blockType?: string;
  nodeId?: string;
  parentId?: string;
  slot?: string;
  index?: number;
}

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
    if (!source || !target || source.id === target.id) return;
    const s = (source.data ?? {}) as DragData;
    const t = (target.data ?? {}) as DragData;
    if (t.kind !== "node" || t.parentId == null || t.slot == null) return;

    const parent = findNode(root, t.parentId);
    if (!parent) return;
    const index = t.index ?? 0;

    if (s.kind === "library" && s.blockType) {
      if (!canDrop(parent.type, t.slot, s.blockType, defaultBlockRegistry).ok) {
        return;
      }
      dispatch({
        type: "ADD",
        parentId: t.parentId,
        slot: t.slot,
        nodeType: s.blockType,
        index,
      });
    } else if (s.kind === "node" && s.nodeId) {
      const moving = findNode(root, s.nodeId);
      if (!moving) return;
      if (!canDrop(parent.type, t.slot, moving.type, defaultBlockRegistry).ok) {
        return;
      }
      dispatch({
        type: "MOVE",
        id: s.nodeId,
        parentId: t.parentId,
        slot: t.slot,
        index,
      });
    }
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
    </DragDropProvider>
  );
}
