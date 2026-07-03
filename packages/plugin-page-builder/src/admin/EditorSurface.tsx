"use client";

/**
 * The 3-pane editor surface (spec §9): left block rail | center canvas | right
 * inspector, with a breakpoint switcher. Rail + inspector are stubs in M4 (filled in
 * M5); the store + canvas + save are live.
 */
import { Button } from "@nextlyhq/ui";

import { Canvas } from "./canvas/Canvas";
import { Inspector } from "./panels/Inspector";
import { useEditor } from "./store/EditorProvider";

const BREAKPOINTS = ["base", "tablet", "mobile"];

export function EditorSurface() {
  const { state, dispatch } = useEditor();

  return (
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
            onClick={() => dispatch({ type: "SET_BREAKPOINT", breakpoint: bp })}
          >
            {bp}
          </Button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr 280px",
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
          Blocks (M5)
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
  );
}
