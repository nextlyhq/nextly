// fallow-ignore-file -- a throwaway spike on a branch that never merges;
// it is run by hand (`node build.mjs`) and deleted with its branch.
/**
 * SPIKE, throwaway: the canvas rendered into an editor-owned same-origin iframe.
 *
 * One React root in the host page. The page tree is portalled into the frame's
 * body, so there is still one tree and one store. Everything that matters to
 * the two risks is the real module, not a stand-in:
 *
 * - the store is the builder's `useEditorState`;
 * - inline rich text is the builder's `useInlineRichText`, loading the admin's
 *   `loadInlineRichTextEditor` (the admin's one Lexical copy);
 * - autoscroll is the builder's `autoscrollStep`;
 * - the host-side indicator is placed with the builder's `geometry.ts` mapping.
 *
 * The drag here is a cut-down copy of `canvas-drag.tsx`'s mechanics (4px
 * activation, capture on activation, document listeners, a rAF pump), with the
 * one change the frame needs: listeners go on the frame's document, never the
 * global one.
 */

import {
  registerBlocks,
  RICH_TEXT_PROP_TYPE,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { RichText } from "@nextlyhq/blocks-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import { loadInlineRichTextEditor } from "../../../admin/src/lib/rich-text/inline-editor";
import { autoscrollStep } from "../../src/autoscroll";
import { useEditorState } from "../../src/editor-state";
import {
  frameContentOrigin,
  pointToCanvas,
  pointToHost,
  type FrameGeometry,
} from "../../src/geometry";
import { frameInsetOf } from "../../src/geometry-dom";
import { useInlineRichText } from "../../src/use-inline-rich-text";

const params = new URLSearchParams(location.search);
const ZOOM = Number(params.get("zoom") ?? "0.75");
const FRAME_W = 800;
const FRAME_H = 600;

registerBlocks(
  [
    {
      version: 1,
      description: "A section with a passage.",
      example: { props: {} },
      render: () => null,
      name: "spike/section",
      props: { body: { type: RICH_TEXT_PROP_TYPE, inline: true } },
    },
  ] as never,
  { source: "canvas-frame-spike" }
);

function passage(text: string): unknown {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: null,
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: null,
          textFormat: 0,
          textStyle: "",
          children: [
            {
              type: "text",
              text,
              format: 0,
              style: "",
              mode: "normal",
              detail: 0,
              version: 1,
            },
          ],
        },
      ],
    },
  };
}

let counter = 0;
function section(label: string): BlockNode {
  return {
    id: `s${counter++}`,
    type: "spike/section",
    version: 1,
    props: { body: passage(`${label} passage text`) },
  };
}

const INITIAL: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: Array.from({ length: 12 }, (_, i) => section(`Section ${i}`)),
};

/** The site's sheet, emitted into the frame's head as published. */
const SITE_CSS = `
  html, body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  .section { min-height: 160px; padding: 16px 24px; box-sizing: border-box;
             border-bottom: 1px solid #ccd; background: #fff; }
  .section:nth-child(even) { background: #f4f6fb; }
  .grip { display: inline-block; padding: 2px 8px; border-radius: 4px;
          background: #223; color: #fff; font-size: 12px; cursor: grab;
          user-select: none; touch-action: none; }
  .vw-probe { width: 50vw; height: 4px; background: #c33; }
  .mq-probe::after { content: "narrow"; }
  @media (min-width: 700px) { .mq-probe::after { content: "wide"; } }
`;

const SRCDOC = `<!doctype html><html><head><meta charset="utf-8"><style>${SITE_CSS}</style></head><body></body></html>`;

/** What the test reads back. Plain data, refreshed every render. */
interface SpikeLog {
  frameMoves: number;
  hostMoves: number;
  outsideMoves: number;
  lastFramePoint: { x: number; y: number } | null;
  scrolled: number;
  ups: { source: "frame" | "host"; x: number; y: number }[];
  drops: string[];
  swallowedClicks: number;
}

const log: SpikeLog = {
  frameMoves: 0,
  hostMoves: 0,
  outsideMoves: 0,
  lastFramePoint: null,
  scrolled: 0,
  ups: [],
  drops: [],
  swallowedClicks: 0,
};

interface Drag {
  kind: "move" | "insert";
  id: string | null;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  /** The pointer, in FRAME client coordinates. */
  x: number;
  y: number;
  frame: number;
  detach: () => void;
}

function App(): React.ReactElement {
  const state = useEditorState({ initialDocument: INITIAL });
  const rich = useInlineRichText(state, loadInlineRichTextEditor, outcome => {
    (window as unknown as { __lastOutcome: unknown }).__lastOutcome = outcome;
  });
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  const [indicator, setIndicator] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const geometry = useCallback((): FrameGeometry => {
    const frame = iframe.current!;
    const box = frame.getBoundingClientRect();
    return {
      origin: frameContentOrigin(
        { x: box.left, y: box.top },
        frameInsetOf(frame),
        ZOOM
      ),
      scale: ZOOM,
    };
  }, []);

  /** Which index a frame-space Y falls at, from the sections' own rects. */
  const indexAt = useCallback((y: number): number => {
    const doc = iframe.current!.contentDocument!;
    const nodes = stateRef.current.document.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const el = doc.querySelector(`[data-nx-node="${nodes[i].id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return nodes.length;
  }, []);

  /** The indicator is chrome, so it is drawn in the HOST, mapped from the frame. */
  const showIndicator = useCallback(
    (index: number) => {
      const doc = iframe.current!.contentDocument!;
      const nodes = stateRef.current.document.nodes;
      const el =
        index < nodes.length
          ? doc.querySelector(`[data-nx-node="${nodes[index].id}"]`)
          : doc.querySelector(`[data-nx-node="${nodes[nodes.length - 1].id}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const y = index < nodes.length ? r.top : r.bottom;
      setIndicator(pointToHost({ x: 0, y }, geometry()).y);
    },
    [geometry]
  );

  const pump = useCallback(() => {
    const d = drag.current;
    const frame = iframe.current;
    if (!d || !d.active || !frame) return;
    const win = frame.contentWindow!;
    const scroller = frame.contentDocument!.scrollingElement!;
    const insideX = d.x >= 0 && d.x <= FRAME_W;
    const step = insideX ? autoscrollStep(d.y, 0, win.innerHeight) : 0;
    if (step !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      if (scroller.scrollTop !== before) {
        log.scrolled += scroller.scrollTop - before;
        showIndicator(indexAt(d.y));
      }
    }
    d.frame = win.requestAnimationFrame(pump);
  }, [indexAt, showIndicator]);

  const finish = useCallback(
    (commit: boolean) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      d.detach();
      iframe.current?.contentWindow?.cancelAnimationFrame(d.frame);
      setIndicator(null);
      if (!d.active || !commit) return;
      const inside = d.x >= 0 && d.x <= FRAME_W && d.y >= 0 && d.y <= FRAME_H;
      const index = indexAt(Math.min(Math.max(d.y, 0), FRAME_H));
      if (d.kind === "move" && d.id) {
        const from = stateRef.current.document.nodes.findIndex(
          n => n.id === d.id
        );
        const to = index > from ? index - 1 : index;
        stateRef.current.apply({ kind: "move", id: d.id, to: { index: to } });
        log.drops.push(`move ${d.id} -> ${to}`);
      } else if (d.kind === "insert" && inside) {
        const node = section("Inserted");
        stateRef.current.apply({ kind: "insert", node, at: { index } });
        log.drops.push(`insert ${node.id} -> ${index}`);
      } else {
        log.drops.push("insert cancelled (released outside the frame)");
      }
    },
    [indexAt]
  );

  const track = useCallback(
    (x: number, y: number) => {
      const d = drag.current;
      if (!d) return;
      d.x = x;
      d.y = y;
      log.lastFramePoint = { x, y };
      if (x < 0 || y < 0 || x > FRAME_W || y > FRAME_H) log.outsideMoves++;
      if (!d.active && Math.hypot(x - d.startX, y - d.startY) >= 4) {
        d.active = true;
        if (d.kind === "move") {
          // Capture on activation, on a host INSIDE the frame.
          const root = iframe.current!.contentDocument!.querySelector(
            "[data-canvas-root]"
          ) as HTMLElement;
          root.setPointerCapture(d.pointerId);
        }
        d.frame = iframe.current!.contentWindow!.requestAnimationFrame(pump);
      }
      if (d.active) showIndicator(indexAt(Math.min(Math.max(y, 0), FRAME_H)));
    },
    [indexAt, pump, showIndicator]
  );

  /** A block drag starts inside the frame; listeners on the FRAME's document. */
  const onGrip = useCallback(
    (event: React.PointerEvent, id: string) => {
      if (event.button !== 0 || rich.editing) return;
      event.preventDefault();
      const doc = (event.target as Node).ownerDocument!;
      const move = (e: PointerEvent) => {
        log.frameMoves++;
        track(e.clientX, e.clientY);
      };
      const up = (e: PointerEvent) => {
        log.ups.push({ source: "frame", x: e.clientX, y: e.clientY });
        const wasActive = drag.current?.active;
        finish(true);
        if (wasActive) {
          const swallow = (c: Event) => {
            log.swallowedClicks++;
            c.stopPropagation();
            c.preventDefault();
          };
          doc.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => doc.removeEventListener("click", swallow, true), 0);
        }
      };
      const cancel = () => finish(false);
      doc.addEventListener("pointermove", move, true);
      doc.addEventListener("pointerup", up, true);
      doc.addEventListener("pointercancel", cancel, true);
      drag.current = {
        kind: "move",
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        x: event.clientX,
        y: event.clientY,
        frame: 0,
        detach: () => {
          doc.removeEventListener("pointermove", move, true);
          doc.removeEventListener("pointerup", up, true);
          doc.removeEventListener("pointercancel", cancel, true);
        },
      };
    },
    [finish, rich.editing, track]
  );

  /**
   * A palette drag starts in the HOST and is not captured (as in
   * `canvas-drag.tsx`). Over the frame the host document stops seeing moves,
   * so it listens on both documents and maps the host's points into the frame.
   */
  const onPalette = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const host = document;
      const doc = iframe.current!.contentDocument!;
      const fromHost = (e: PointerEvent) =>
        pointToCanvas({ x: e.clientX, y: e.clientY }, geometry());
      const hostMove = (e: PointerEvent) => {
        log.hostMoves++;
        const p = fromHost(e);
        track(p.x, p.y);
      };
      const frameMove = (e: PointerEvent) => {
        log.frameMoves++;
        track(e.clientX, e.clientY);
      };
      const hostUp = (e: PointerEvent) => {
        log.ups.push({ source: "host", x: e.clientX, y: e.clientY });
        finish(true);
      };
      const frameUp = (e: PointerEvent) => {
        log.ups.push({ source: "frame", x: e.clientX, y: e.clientY });
        finish(true);
      };
      host.addEventListener("pointermove", hostMove, true);
      host.addEventListener("pointerup", hostUp, true);
      doc.addEventListener("pointermove", frameMove, true);
      doc.addEventListener("pointerup", frameUp, true);
      const start = fromHost(event.nativeEvent);
      drag.current = {
        kind: "insert",
        id: null,
        pointerId: event.pointerId,
        startX: start.x,
        startY: start.y,
        active: false,
        x: start.x,
        y: start.y,
        frame: 0,
        detach: () => {
          host.removeEventListener("pointermove", hostMove, true);
          host.removeEventListener("pointerup", hostUp, true);
          doc.removeEventListener("pointermove", frameMove, true);
          doc.removeEventListener("pointerup", frameUp, true);
        },
      };
    },
    [finish, geometry, track]
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent, id: string) => {
      const element = (event.target as Element).closest("[data-nx-prop]");
      if (!element) return;
      // Selected first, as the canvas does: the hook drops an edit whose block
      // is not the selected one.
      state.select(id);
      const point = { x: event.clientX, y: event.clientY };
      (window as unknown as { __began: unknown }).__began = rich.begin(
        id,
        "body",
        element,
        point
      );
    },
    [rich, state]
  );

  // Escape inside the frame does not reach the host, so it is bound in the frame.
  useEffect(() => {
    if (!frameDoc) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) finish(false);
    };
    frameDoc.addEventListener("keydown", key, true);
    return () => frameDoc.removeEventListener("keydown", key, true);
  }, [finish, frameDoc]);

  (window as unknown as { __spike: unknown }).__spike = {
    log,
    zoom: ZOOM,
    document: () => stateRef.current.document,
    editing: () => rich.editing,
    frame: () => iframe.current,
  };

  const page = (
    <div data-canvas-root="" style={{ touchAction: "none" }}>
      <div className="vw-probe" data-testid="vw-probe" />
      <div className="mq-probe" data-testid="mq-probe" />
      {state.document.nodes.map(node => (
        <section
          key={node.id}
          className="section"
          data-nx-node={node.id}
          onDoubleClick={e => onDoubleClick(e, node.id)}
        >
          <span
            className="grip"
            data-grip={node.id}
            onPointerDown={e => onGrip(e, node.id)}
          >
            ⠿ {node.id}
          </span>
          <div data-nx-prop="body" data-body={node.id}>
            <RichText value={(node.props as { body: unknown }).body} />
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <div
      style={{
        font: "14px system-ui",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        data-testid="toolbar"
        style={{
          height: 80,
          background: "#1d2230",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          flex: "none",
        }}
      >
        <strong>Canvas frame spike</strong>
        <button data-testid="done" onClick={() => rich.commit()}>
          Done editing
        </button>
        <button data-testid="cancel" onClick={() => rich.cancel()}>
          Cancel editing
        </button>
        <span data-testid="editing">
          {rich.editing ? `editing ${rich.editing.nodeId}` : "not editing"}
        </span>
      </header>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          style={{ width: 200, background: "#eef", padding: 16, flex: "none" }}
        >
          <div
            data-testid="palette"
            onPointerDown={onPalette}
            style={{
              padding: 12,
              background: "#fff",
              border: "1px solid #99a",
              cursor: "grab",
              userSelect: "none",
              touchAction: "none",
            }}
          >
            + Section
          </div>
        </aside>
        <main
          style={{
            flex: 1,
            position: "relative",
            padding: 40,
            background: "#888",
          }}
        >
          <div
            style={{
              width: FRAME_W * ZOOM,
              height: FRAME_H * ZOOM,
              position: "relative",
            }}
          >
            <iframe
              ref={iframe}
              title="Page canvas: Spike"
              data-testid="frame"
              srcDoc={SRCDOC}
              onLoad={e => setFrameDoc(e.currentTarget.contentDocument)}
              style={{
                width: FRAME_W,
                height: FRAME_H,
                border: 0,
                display: "block",
                transform: `scale(${ZOOM})`,
                transformOrigin: "0 0",
                background: "#fff",
              }}
            />
          </div>
          {indicator !== null && (
            <div
              data-testid="indicator"
              style={{
                position: "fixed",
                left: 240,
                width: FRAME_W * ZOOM,
                top: indicator - 1,
                height: 3,
                background: "#2a6cf0",
                pointerEvents: "none",
              }}
            />
          )}
        </main>
      </div>
      <footer
        style={{ height: 80, background: "#1d2230", flex: "none" }}
        data-testid="statusbar"
      />
      {frameDoc && createPortal(page, frameDoc.body)}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
