"use client";

/**
 * Which document and window the canvas is rendered in.
 *
 * The canvas is meant to render inside a same-origin iframe the editor owns,
 * so that media queries, `vw` and `vh` answer for the previewed device rather
 * than for the admin window. Everything that listens, observes or asks a media
 * query on the canvas's behalf then has to do it in the FRAME's document and
 * window: a pointer moving over the frame is delivered to the frame's document
 * and never reaches the admin's, a key pressed with focus inside it is
 * dispatched there, and `matchMedia` in the admin window answers for the
 * admin's width, not the device's.
 *
 * Code that holds a canvas node asks the node: `node.ownerDocument` and its
 * `defaultView` are the canvas's document and window wherever the node lives,
 * and an observer built from that window is built in the realm of what it
 * observes. This context is for the code that holds no canvas node — a drag
 * begun from a palette row, the inspector's media queries, the keyboard — and
 * it answers the same question for them.
 *
 * With no provider, and with a provider given no frame, the answer is the
 * editor's own document and window: the canvas renders in the same document
 * as the editor, which is what a unit test or a harness mounting the canvas
 * directly is doing.
 *
 * @module canvas-frame-context
 */

import {
  useIsomorphicLayoutEffect,
  useShortcutManager,
  type ShortcutManager,
} from "@nextlyhq/ui";
import * as React from "react";

import type { FrameSize } from "./canvas-width";
import type { Point } from "./geometry";
import { framePointInHost, hostPointInFrame } from "./geometry-dom";

/**
 * The frame the canvas renders in and the document it holds now, or `null`
 * for the editor's own document.
 */
const CanvasFrameContext = React.createContext<CanvasFrame | null>(null);

/**
 * Where the canvas is rendered, as the code around it needs to know.
 *
 * `document` and `window` are `null` only where there is no DOM at all, a
 * server render, and in a frame whose document is not readable. Every reader
 * here runs in an effect or an event, so a `null` there means there is nothing
 * to listen on rather than something to work around.
 *
 * @experimental
 */
export interface CanvasFrame {
  /** The iframe the canvas renders in, or `null` while it shares the editor's document. */
  readonly frame: HTMLIFrameElement | null;
  /** The document the canvas's nodes belong to. */
  readonly document: Document | null;
  /** That document's window: the one whose media queries describe the canvas. */
  readonly window: (Window & typeof globalThis) | null;
  /**
   * How much larger the editor paints the frame than it lays it out: `0.5` at
   * 50%. `1` with no frame, where nothing is scaled.
   *
   * A value that changes whenever the zoom or the fit does, so chrome drawn
   * over the frame can depend on it to be placed again: nothing inside the
   * frame resizes when only its painted scale moves, so no observer there
   * reports it.
   */
  readonly scale: number;
  /**
   * The part of the frame's page on screen, in the frame's own CSS pixels and
   * without its scrollbars, or `null` with no frame. What chrome that has to
   * stay visible, such as a toolbar flipping at the top edge, is kept inside.
   */
  readonly viewport: FrameSize | null;
  /** A point in the canvas document's client coordinates, in the editor's. */
  readonly toHost: (point: Point) => Point;
  /** A point in the editor's client coordinates, in the canvas document's. */
  readonly toCanvas: (point: Point) => Point;
}

/** What a mounted frame reports about how it is drawn. */
interface CanvasFrameLayout {
  readonly scale: number;
  readonly viewport: FrameSize | null;
}

/**
 * How a frame rendered beneath an uncontrolled provider hands its iframe and
 * its layout up to it.
 *
 * `null` under a provider told its frame directly, and with no provider at
 * all: the frame then provides for itself.
 */
interface FrameRegistration {
  readonly register: (frame: HTMLIFrameElement | null) => void;
  readonly report: (layout: CanvasFrameLayout) => void;
}

const FrameRegistrationContext = React.createContext<FrameRegistration | null>(
  null
);

/**
 * Where a frame registers itself, or `null` when nothing above will hear it.
 *
 * @internal
 */
export function useFrameRegistration(): FrameRegistration | null {
  return React.useContext(FrameRegistrationContext);
}

/**
 * The answer, held where nothing walking an object's own keys can reach the
 * frame, its document or its window.
 *
 * The value is a context provider's prop, and React's development build
 * describes a changed prop by walking the object's own enumerable keys a few
 * levels down. A window's own keys include each frame inside it, and a page
 * with an Embed block holds one in an opaque origin, where reading anything
 * throws a `SecurityError` in the middle of React's commit. Private fields
 * behind getters are not own keys, so the walk finds nothing to enter.
 */
class CanvasFrameView implements CanvasFrame {
  readonly #frame: HTMLIFrameElement | null;
  readonly #document: Document | null;
  readonly scale: number;
  readonly viewport: FrameSize | null;

  constructor(
    frame: HTMLIFrameElement | null,
    doc: Document | null,
    layout: CanvasFrameLayout
  ) {
    this.#frame = frame;
    this.#document = doc;
    this.scale = layout.scale;
    this.viewport = layout.viewport;
  }

  get frame(): HTMLIFrameElement | null {
    return this.#frame;
  }

  get document(): Document | null {
    return this.#document;
  }

  get window(): (Window & typeof globalThis) | null {
    return this.#document?.defaultView ?? null;
  }

  // Read live at the call: where the frame sits on screen moves with every
  // scroll of the editor, which no render reports.
  toHost = (point: Point): Point => {
    const frame = this.#frame;
    return frame === null ? point : framePointInHost(frame, point);
  };

  toCanvas = (point: Point): Point => {
    const frame = this.#frame;
    return frame === null ? point : hostPointInFrame(frame, point);
  };
}

/** A frame's layout before it has reported one. */
const UNREPORTED: CanvasFrameLayout = { scale: 1, viewport: null };

/** A frame and the document it was last seen holding. */
interface SeenDocument {
  readonly frame: HTMLIFrameElement | null;
  readonly document: Document | null;
}

/**
 * Names the iframe the canvas renders in, for everything beneath it.
 *
 * `null`, like no provider at all, means the canvas is in the editor's own
 * document.
 *
 * The frame's document is HELD in state and re-read on the frame's `load`,
 * rather than read off `contentDocument` while rendering. A frame replaces its
 * document when it loads — its first `about:blank` gives way to its content,
 * and a reload builds another — and nothing in that renders. Read during
 * render, every listener and media query beneath would stay on the document
 * that was thrown away until some unrelated render happened to read again.
 * Held here, the replacement is itself the update: consumers depending on the
 * document or window re-run, detaching from the old one and attaching to the
 * new.
 *
 * @experimental
 */
export function CanvasFrameProvider({
  frame: given,
  children,
}: {
  /**
   * The frame, when the caller holds it. Left out, the provider waits for a
   * `CanvasFrame` beneath it to register its own, which is how an editor
   * provides the frame to the panels and keys around the canvas as well as to
   * the canvas itself.
   */
  frame?: HTMLIFrameElement | null;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [registered, setRegistered] = React.useState<HTMLIFrameElement | null>(
    null
  );
  const [layout, setLayout] = React.useState<CanvasFrameLayout>(UNREPORTED);
  const controlled = given !== undefined;
  const frame = controlled ? given : registered;
  // One object for the life of the provider, so a frame registering does not
  // re-run on every render of what is above it.
  const registration = React.useMemo<FrameRegistration | null>(
    () =>
      controlled
        ? null
        : {
            register: next => {
              setRegistered(next);
              if (next === null) setLayout(UNREPORTED);
            },
            report: next =>
              setLayout(current =>
                current.scale === next.scale &&
                sameSize(current.viewport, next.viewport)
                  ? current
                  : next
              ),
          },
    [controlled]
  );
  const [seen, setSeen] = React.useState<SeenDocument>(() => ({
    frame,
    document: frame?.contentDocument ?? null,
  }));
  React.useEffect(() => {
    if (frame === null) return;
    const read = (): void => {
      const current = frame.contentDocument;
      // The same pair returns the same object, so a load that changed nothing
      // renders nothing.
      setSeen(previous =>
        previous.frame === frame && previous.document === current
          ? previous
          : { frame, document: current }
      );
    };
    // Once now as well: the frame may have loaded between the render that
    // handed it here and this effect, and that load has already fired.
    read();
    frame.addEventListener("load", read);
    return () => frame.removeEventListener("load", read);
  }, [frame]);
  /*
   * A frame handed in that the state does not hold — a new frame, the frame
   * cleared, or one handed back after being cleared — is read FRESH, here,
   * and the state replaced before this render commits. Kept instead, a frame
   * handed back would answer with the document it held when it was taken
   * away, which it may have dropped since, unwatched; clearing the frame
   * forgets it for the same reason. React re-runs this render with the new
   * state before committing, so no committed render answers with a stale
   * document.
   */
  let doc = seen.document;
  if (seen.frame !== frame) {
    doc = frame?.contentDocument ?? null;
    setSeen({ frame, document: doc });
  }
  const value = React.useMemo<CanvasFrame | null>(
    () => (frame === null ? null : new CanvasFrameView(frame, doc, layout)),
    [frame, doc, layout]
  );
  return (
    <FrameRegistrationContext.Provider value={registration}>
      <CanvasFrameContext.Provider value={value}>
        {children}
      </CanvasFrameContext.Provider>
    </FrameRegistrationContext.Provider>
  );
}

/** Whether two sizes are the same, `null` included. */
function sameSize(a: FrameSize | null, b: FrameSize | null): boolean {
  if (a === null || b === null) return a === b;
  return a.width === b.width && a.height === b.height;
}

/**
 * The document and window the canvas is rendered in.
 *
 * In a frame, the document its provider last saw it load, which changes when
 * the frame loads another: a dependency on `.document` or `.window` then
 * re-runs the effect that listened on the old one. With no frame, the
 * editor's own document and window, which do not change.
 *
 * @experimental
 */
export function useCanvasFrame(): CanvasFrame {
  const framed = React.useContext(CanvasFrameContext);
  const own = React.useMemo<CanvasFrame>(
    () =>
      new CanvasFrameView(
        null,
        typeof document === "undefined" ? null : document,
        UNREPORTED
      ),
    []
  );
  return framed ?? own;
}

/**
 * Every document an input gesture on the canvas can be delivered to.
 *
 * Two while the canvas is in a frame: the editor's own, where the palette,
 * the panels and their search fields are, and the frame's, where the page is.
 * A pointer moving over the frame is delivered to the frame's document alone
 * and one moving over the panels to the editor's alone, so a gesture that
 * crosses between them is only heard whole by listening on both. A key goes to
 * whichever document holds focus, which is either.
 *
 * One while the canvas shares the editor's document, because the two are the
 * same document and listening on it twice would run every listener twice.
 *
 * The editor's document is the frame's OWNER document: the iframe element is
 * part of the editor's page, whichever window is asking.
 */
export function inputDocuments(canvas: CanvasFrame): readonly Document[] {
  const host = canvas.frame?.ownerDocument ?? canvas.document;
  const documents: Document[] = [];
  for (const doc of [host, canvas.document]) {
    if (doc !== null && !documents.includes(doc)) documents.push(doc);
  }
  return documents;
}

/** One manager's listener on one document, and how many asked for it. */
interface Attachment {
  count: number;
  readonly detach: () => void;
}

/**
 * The listeners this module has installed, per manager and per document.
 *
 * Counted rather than installed per caller, because two listeners from ONE
 * manager on one document run every binding twice for one key — a save
 * started twice, an undo that steps back two edits. Weakly keyed both ways, so
 * a frame's document that has been replaced, and everything it holds, is not
 * kept alive by having once been listened on.
 */
const attachments = new WeakMap<
  ShortcutManager,
  WeakMap<Document, Attachment>
>();

function attachOnce(manager: ShortcutManager, target: Document): () => void {
  let byDocument = attachments.get(manager);
  if (byDocument === undefined) {
    byDocument = new WeakMap();
    attachments.set(manager, byDocument);
  }
  const entry = byDocument.get(target) ?? {
    count: 0,
    detach: manager.attach(target),
  };
  byDocument.set(target, entry);
  entry.count += 1;
  const owner = byDocument;
  let released = false;
  return () => {
    // Idempotent per caller, so a release that runs twice cannot take the
    // listener from under another caller still counted.
    if (released) return;
    released = true;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.detach();
    owner.delete(target);
  };
}

/**
 * Hears the editor's shortcuts in the canvas's document too.
 *
 * A key pressed with focus inside the frame is dispatched in the FRAME's
 * document, and the shell's shortcut manager listens on the editor's. Without
 * this, Mod+S, undo, Escape and every other binding would go dead the moment
 * the author clicked into the page.
 *
 * The SAME manager, attached to a second document, never a second manager. A
 * `ShortcutProvider` nested with the frame as its target would build one of its
 * own, and the bindings registered on the shell's — the admin's save among
 * them — would not be in it, so they would not fire inside the frame at all.
 *
 * Nothing while the canvas shares the editor's document: the manager already
 * listens there, and a second listener would run every binding twice.
 * Released when the frame's document goes, so a reloaded frame is listened on
 * once, in its new document. Counted per document by {@link attachOnce}, so a
 * Strict Mode replay or a second caller does not install a second listener.
 *
 * Rendered inside the shell's `ShortcutProvider`.
 *
 * @experimental
 */
export function CanvasFrameShortcuts(): null {
  const manager = useShortcutManager();
  const { document: canvasDocument } = useCanvasFrame();
  // Layout timing, as the shell's own provider attaches: a passive effect
  // listens only after paint, and a key pressed in the frame between the
  // commit that shows it and that effect would reach no binding at all.
  useIsomorphicLayoutEffect(() => {
    if (canvasDocument === null) return;
    if (canvasDocument === globalThis.document) return;
    return attachOnce(manager, canvasDocument);
  }, [manager, canvasDocument]);
  return null;
}
