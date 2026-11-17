"use client";

/**
 * ⌘C, ⌘X and ⌘V on the selected blocks, through the browser's own copy, cut
 * and paste events rather than key bindings.
 *
 * The events are what carry the clipboard: a copy or cut event takes the text
 * to put on it, and a paste event is the one place a page reads the clipboard
 * without asking the author's permission first. Heard in the editor's
 * document and in the canvas frame's, since a key pressed with focus in the
 * frame raises its event there.
 *
 * **Text keeps its keys.** A press in a text field, in a block's text being
 * edited on the canvas, or over text the author has highlighted is left to the
 * browser, so it copies, cuts and pastes text exactly as it would without the
 * editor. Only a press with no text in play acts on blocks.
 *
 * @module block-clipboard-events
 */

import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import {
  isClipboardEvent,
  putOnClipboard,
  textOfPaste,
} from "./block-clipboard-transport";
import type { BlockClipboardVerbs } from "./block-clipboard-verbs";
import { isTextEntry, modalIsOpen } from "./canvas/canvas-escape";
import { useCanvasFrame } from "./canvas/canvas-frame-context";
import { isElement } from "./dom-kind";
import { BUILDER_CHROME_CLASS } from "./shell-state";

/**
 * The keys, as Help lists them.
 *
 * Bindings that never fire (`when` is always false): the keys act through
 * the browser's clipboard events below, so a binding that took the keystroke
 * would stop the very event that carries the clipboard. Registered so Help,
 * which reads the editor's bindings, lists what these keys do.
 */
export const CLIPBOARD_KEY_HELP = (
  [
    ["mod+c", "Copy the selected blocks"],
    ["mod+x", "Cut the selected blocks"],
    ["mod+v", "Paste copied blocks"],
  ] as const
).map(([keys, description]) => ({
  keys,
  description,
  when: () => false,
  whenTyping: false,
  preventDefault: false,
  run: () => undefined,
}));

/**
 * Whether a clipboard event is the editor's to answer: raised in the canvas,
 * or in the editor's own chrome, with no text in play and no dialog open.
 */
export function blocksTakeClipboardEvent(
  event: Event,
  editorDocument: Document
): boolean {
  // The browser raises these at the focused element, or the body with
  // nothing focused, so the target is always an element of some document.
  const element = event.target;
  if (!isElement(element)) return false;
  const doc = element.ownerDocument;
  // A dialog over the editor owns the keyboard, Copy included.
  if (modalIsOpen(editorDocument)) return false;
  // A field, or a block's text being edited: the text's own copy and paste.
  if (isTextEntry(element)) return false;
  // Text the author highlighted is what they meant to copy.
  const highlighted = doc.getSelection();
  if (highlighted !== null && !highlighted.isCollapsed) return false;
  // In the editor's document, only from within the editor itself, or with
  // nothing focused at all (a page just opened, before any click): a page
  // hosting the editor keeps its own copy and paste on its own controls.
  if (doc === editorDocument) {
    return (
      element === doc.body ||
      element.closest(`.${BUILDER_CHROME_CLASS}`) !== null
    );
  }
  return true;
}

/**
 * Listen for copy, cut and paste in the editor's document and the canvas
 * frame's, and answer the ones meant for blocks. Draws nothing.
 */
export function BlockClipboardEvents({
  verbs,
  enabled,
}: {
  readonly verbs: BlockClipboardVerbs;
  readonly enabled: boolean;
}): null {
  const canvasDocument = useCanvasFrame().document;
  // The newest verbs, read when an event lands, so listeners are added once
  // per document rather than on every render.
  const latest = React.useRef(verbs);
  latest.current = verbs;

  useIsomorphicLayoutEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const editorDocument = document;
    const documents = new Set<Document>([editorDocument]);
    if (canvasDocument !== null) documents.add(canvasDocument);

    const onCopyOrCut = (event: Event) => {
      if (event.defaultPrevented) return;
      if (!isClipboardEvent(event)) return;
      if (!blocksTakeClipboardEvent(event, editorDocument)) return;
      const write = (text: string) => putOnClipboard(event, text);
      if (event.type === "cut") latest.current.cut(write);
      else latest.current.copy(write);
    };
    const onPaste = (event: Event) => {
      if (event.defaultPrevented) return;
      if (!isClipboardEvent(event)) return;
      if (!blocksTakeClipboardEvent(event, editorDocument)) return;
      const text = textOfPaste(event);
      if (text === undefined) return;
      // Only copied blocks are taken; any other text is the page's to handle.
      if (latest.current.pasteText(text)) event.preventDefault();
    };

    for (const doc of documents) {
      doc.addEventListener("copy", onCopyOrCut);
      doc.addEventListener("cut", onCopyOrCut);
      doc.addEventListener("paste", onPaste);
    }
    return () => {
      for (const doc of documents) {
        doc.removeEventListener("copy", onCopyOrCut);
        doc.removeEventListener("cut", onCopyOrCut);
        doc.removeEventListener("paste", onPaste);
      }
    };
  }, [enabled, canvasDocument]);

  return null;
}
