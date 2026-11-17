"use client";

/**
 * A small picture of a document, wherever an author chooses one: a saved
 * section in the Add panel, a header & footer set in a menu.
 *
 * Drawn by the same `PageRenderer` as the canvas, at the desktop preview's
 * width, scaled to the picture's box and inert. A picture with its own drawing
 * path would be a second answer to "what does this look like", and the two
 * drift where nobody looks.
 *
 * **Generic.** It draws the documents it is handed, top to bottom with a thin
 * gap between them (a set's header above its footer), and knows nothing of
 * sets, sections or templates: the host decides what to draw and with what.
 *
 * **It never holds anything up.** Nothing is drawn until the picture's box is
 * on screen, so a panel or a menu opens at once and a long list draws only
 * the rows scrolled to. A document already seen in the host's session is
 * drawn straight away when its row comes back.
 *
 * **A plain icon in place of a broken picture.** With nothing to draw (an
 * empty set, "None") it shows the empty-frame icon. When the host says the
 * document can't be drawn, or when the renderer had to leave a placeholder
 * for any block in it (a type no block is registered for, a component that
 * could not be loaded, a block that threw: the renderer contains each of
 * those itself), it shows the item's own type icon.
 *
 * **Light or dark, as the canvas is previewed.** The mode is stated on the
 * drawn surface as the site's own theme marker, so a site's dark tokens apply
 * exactly as they do on the canvas, and the drawing is not redone for a switch.
 *
 * The picture is `aria-hidden`: it is the row's picture, and the row's own
 * name is what a screen reader reads.
 *
 * @module document-miniature
 */
import {
  DARK_MODE_ATTRIBUTE,
  type BlockDocument,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { PageRenderer, type PageRendererProps } from "@nextlyhq/blocks-react";
import * as React from "react";

import { BlockIconMark } from "../block-icon";

import {
  MINIATURE_RENDER_WIDTH,
  MiniatureSurface,
  useFirstSeen,
  useWidthScale,
  type MiniatureSession,
} from "./miniature-surface";

/**
 * What a picture is drawn with: the renderer's inputs for this site, except
 * the document, its context and the editor-only switches, which the picture
 * decides itself.
 */
export type MiniatureRender = Omit<
  PageRendererProps,
  "document" | "context" | "nodeAttribute" | "keepAsyncOutputs" | "prepared"
>;

export interface DocumentMiniatureProps {
  /**
   * What to draw, top to bottom: one document, or a set's header above its
   * footer. None draws the empty-frame icon.
   */
  documents: readonly BlockDocument[];
  /** This site's rendering: its sheet, its blocks, its breakpoints. */
  render: MiniatureRender;
  /**
   * The mode the canvas is previewed in, when one is picked. Absent, the
   * document's own, as on the canvas.
   */
  mode?: TokenMode;
  /** The item's type icon, shown in place of a picture that can't be drawn. */
  icon?: string;
  /** The host already knows the documents can't be drawn. */
  failed?: boolean;
  /** What the host's pictures share for as long as it edits. */
  session: MiniatureSession;
  /** The width to compose at before scaling. The desktop preview's by default. */
  renderWidth?: number;
}

/** The gap between two documents drawn one above the other, in composed px. */
const STACK_GAP = 16;

/** An empty frame: a dashed box, for nothing to draw. */
function EmptyFrameIcon(): React.JSX.Element {
  return (
    <svg
      className="nx-picture__empty"
      width="24"
      height="16"
      viewBox="0 0 24 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="22"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
    </svg>
  );
}

/**
 * The marker the renderer leaves where a block could not be drawn: a type no
 * block is registered for, a component that could not be loaded, a block that
 * threw. A picture with one in it is a broken picture.
 */
const PLACEHOLDER_SELECTOR = "[data-nx-block-placeholder]";

/**
 * The height the documents were drawn at, in composed px, kept current as
 * what they draw settles (an image arriving moves everything below it), and
 * whether any block in them could not be drawn, asked at the same moments.
 */
function useDrawnLayout(
  scaled: React.RefObject<HTMLDivElement | null>,
  drawn: boolean,
  onBroken: () => void
): number {
  const [height, setHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = scaled.current;
    if (!drawn || !element) return;
    const measure = (): void => {
      if (element.querySelector(PLACEHOLDER_SELECTOR) !== null) onBroken();
      setHeight(element.offsetHeight);
    };
    measure();
    // A block that gives up after the drawing (an async block that rejects)
    // leaves a hidden placeholder that need not change the drawing's size,
    // so the drawing's content is watched as well as its size.
    const view = element.ownerDocument.defaultView;
    const changes =
      view?.MutationObserver === undefined
        ? null
        : new view.MutationObserver(measure);
    changes?.observe(element, { childList: true, subtree: true });
    const sizes =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    sizes?.observe(element);
    return () => {
      changes?.disconnect();
      sizes?.disconnect();
    };
  }, [scaled, drawn, onBroken]);
  return height;
}

/** What the picture shows: nothing to draw, the icon, or the documents. */
type PictureState = "empty" | "failed" | "drawn";

function stateOf(
  documents: readonly BlockDocument[],
  failed: boolean
): PictureState {
  if (documents.length === 0) return "empty";
  return failed ? "failed" : "drawn";
}

/**
 * The documents as first handed in, for as long as the host hands the same
 * ones: a host building `[document]` inline hands a new list on every render
 * of its own (each keystroke in a panel's search), and the drawing below is
 * memoised on the list.
 */
function useSameDocuments(
  documents: readonly BlockDocument[]
): readonly BlockDocument[] {
  const [held, setHeld] = React.useState(documents);
  if (held === documents) return held;
  const same =
    held.length === documents.length &&
    held.every((document, index) => document === documents[index]);
  if (same) return held;
  // Derived state, set while rendering as React allows for it: the next
  // render holds the new list.
  setHeld(documents);
  return documents;
}

/**
 * The device's colour scheme, for the ground of a picture with no previewed
 * mode: the canvas's frame follows the device then, and so does the site's
 * dark sheet, so a picture grounded in the admin's own scheme would put a
 * light page on a dark ground. Undefined until read after mount (a server
 * render has no device), or while a mode is previewed, when nothing listens.
 */
function useDeviceScheme(listen: boolean): TokenMode | undefined {
  const [scheme, setScheme] = React.useState<TokenMode | undefined>(undefined);
  React.useEffect(() => {
    // Asked by callability: jsdom has the property without the function.
    if (!listen || typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const read = (): void => setScheme(query.matches ? "dark" : "light");
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, [listen]);
  return listen ? scheme : undefined;
}

/** The documents, one above the other, held apart from the scale. */
function useDrawnDocuments(
  documents: readonly BlockDocument[],
  render: MiniatureRender,
  session: MiniatureSession
): React.ReactNode {
  /*
   * Held apart from the measured scale and the mode, which change without the
   * documents changing: rebuilt inline, every resize would rerun the whole
   * render beneath it.
   */
  return React.useMemo(
    () =>
      documents.map((document, index) => (
        <div
          // Position is identity here: the list is the host's fixed order
          // (a header, then a footer) and never reorders.
          key={index}
          style={index === 0 ? undefined : { marginTop: STACK_GAP }}
          className="nx-picture__document"
        >
          <PageRenderer
            {...render}
            document={document}
            context={session.context}
            // What async blocks drew is kept between pictures and openings,
            // as on the canvas, so an image does not blink.
            keepAsyncOutputs
          />
        </div>
      )),
    [documents, render, session]
  );
}

/**
 * Whether the drawing of `documents` with `render` found a placeholder, and
 * how the drawing says it did. Held for the inputs it was drawn with: new
 * documents or a new rendering (a component's definition read after the
 * panel opened) are drawn again rather than kept as the icon.
 */
function useBrokenDrawing(
  documents: readonly BlockDocument[],
  render: MiniatureRender
): { readonly broken: boolean; readonly broke: () => void } {
  const [brokenFor, setBrokenFor] = React.useState<{
    documents: readonly BlockDocument[];
    render: MiniatureRender;
  } | null>(null);
  const broke = React.useCallback(
    () => setBrokenFor({ documents, render }),
    [documents, render]
  );
  const broken =
    brokenFor !== null &&
    brokenFor.documents === documents &&
    brokenFor.render === render;
  return { broken, broke };
}

/**
 * Whether the picture has come on screen, or `first`, its first document,
 * was already seen in the editor's session, which is then told it was.
 */
function useSeenInSession(
  frame: React.RefObject<HTMLSpanElement | null>,
  first: BlockDocument | undefined,
  session: MiniatureSession
): boolean {
  const seen = useFirstSeen(
    frame,
    first !== undefined && session.seen.has(first)
  );
  React.useEffect(() => {
    if (seen && first !== undefined) session.seen.add(first);
  }, [seen, first, session]);
  return seen;
}

/**
 * The drawing itself, mounted only once the picture has come on screen and
 * has documents to draw: measured, scaled and composed here, so a tile not
 * yet drawn costs no observer and no render beneath it.
 */
function DrawnPicture({
  frame,
  documents,
  render,
  mode,
  session,
  renderWidth,
  onBroken,
}: {
  frame: React.RefObject<HTMLSpanElement | null>;
  documents: readonly BlockDocument[];
  render: MiniatureRender;
  mode: DocumentMiniatureProps["mode"];
  session: MiniatureSession;
  renderWidth: number;
  onBroken: () => void;
}): React.JSX.Element {
  const scaled = React.useRef<HTMLDivElement>(null);
  const scale = useWidthScale(frame, renderWidth, true);
  const composed = useDrawnLayout(scaled, true, onBroken);
  const pages = useDrawnDocuments(documents, render, session);
  const boxHeight = frame.current?.clientHeight ?? 0;
  // A document shorter than the box sits in its middle; a taller one is
  // shown from its top.
  const offsetTop = Math.max(0, (boxHeight - composed * scale) / 2);
  return (
    <MiniatureSurface
      scaledRef={scaled}
      renderWidth={renderWidth}
      scale={scale}
      previewContainer={render.styleContext?.previewContainer}
      offsetTop={offsetTop}
      slot="picture"
    >
      <div
        className="nx-picture__page"
        {...(mode === undefined ? {} : { [DARK_MODE_ATTRIBUTE]: mode })}
      >
        {pages}
      </div>
    </MiniatureSurface>
  );
}

export function DocumentMiniature({
  documents,
  render,
  mode,
  icon,
  failed = false,
  session,
  renderWidth = MINIATURE_RENDER_WIDTH,
}: DocumentMiniatureProps): React.JSX.Element {
  const frame = React.useRef<HTMLSpanElement>(null);
  const drawnDocuments = useSameDocuments(documents);
  const { broken, broke } = useBrokenDrawing(drawnDocuments, render);
  const state = stateOf(drawnDocuments, failed || broken);
  const seen = useSeenInSession(frame, drawnDocuments[0], session);
  const drawn = seen && state === "drawn";
  const device = useDeviceScheme(mode === undefined);
  const scheme = mode ?? device;

  return (
    <span
      ref={frame}
      className="nx-picture"
      data-state={state}
      data-drawn={drawn ? "true" : undefined}
      // The previewed scheme for the whole box, else the device's, so the
      // ground around a short document is the page's own and not the admin's.
      style={scheme === undefined ? undefined : { colorScheme: scheme }}
      aria-hidden="true"
    >
      {state === "empty" ? <EmptyFrameIcon /> : null}
      {state === "failed" ? <BlockIconMark icon={icon} size={20} /> : null}
      {drawn ? (
        <DrawnPicture
          frame={frame}
          documents={drawnDocuments}
          render={render}
          mode={mode}
          session={session}
          renderWidth={renderWidth}
          onBroken={broke}
        />
      ) : null}
    </span>
  );
}
