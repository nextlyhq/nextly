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

import { useShortcutManager, type ShortcutManager } from "@nextlyhq/ui";
import * as React from "react";

/** The iframe the canvas renders in, or `null` for the editor's own document. */
const CanvasFrameContext = React.createContext<HTMLIFrameElement | null>(null);

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
}

/**
 * Names the iframe the canvas renders in, for everything beneath it.
 *
 * `null`, like no provider at all, means the canvas is in the editor's own
 * document.
 *
 * @experimental
 */
export function CanvasFrameProvider({
  frame,
  children,
}: {
  frame: HTMLIFrameElement | null;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <CanvasFrameContext.Provider value={frame}>
      {children}
    </CanvasFrameContext.Provider>
  );
}

/**
 * The document and window the canvas is rendered in.
 *
 * Read during render, as hooks are, and the document and window are compared
 * by identity in the returned object's memo: a frame whose document is
 * replaced by a reload answers with the new one on the next render, and a
 * dependency on `.document` or `.window` re-runs the effect that listened on
 * the old one.
 *
 * @experimental
 */
export function useCanvasFrame(): CanvasFrame {
  const frame = React.useContext(CanvasFrameContext);
  const doc =
    frame === null
      ? typeof document === "undefined"
        ? null
        : document
      : frame.contentDocument;
  const view = doc?.defaultView ?? null;
  return React.useMemo(
    () => ({ frame, document: doc, window: view }),
    [frame, doc, view]
  );
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
  React.useEffect(() => {
    if (canvasDocument === null) return;
    if (canvasDocument === globalThis.document) return;
    return attachOnce(manager, canvasDocument);
  }, [manager, canvasDocument]);
  return null;
}
