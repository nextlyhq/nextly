/**
 * Moving copied blocks on and off the system clipboard.
 *
 * The system clipboard, so a copy in one page or browser tab pastes in
 * another. The text goes under two types: copied blocks' own type, and plain
 * text, which is the one type every browser carries between tabs and the
 * only one a menu's Paste can read back (`navigator.clipboard.readText`).
 * Plain text is read as blocks only when it is a copied-blocks object, so
 * ordinary text is never mistaken for blocks.
 *
 * The last text copied in this tab is also kept here, for a menu Paste where
 * the browser refuses to read the clipboard. A keyboard paste needs no
 * fallback: the paste event carries the clipboard's contents itself.
 *
 * @module block-clipboard-transport
 */

import { BLOCK_CLIPBOARD_TYPE } from "./block-clipboard";

/** The last copied blocks' text in this tab, for a Paste the browser will not read for. */
let lastCopied: string | undefined;

/**
 * Put copied blocks on a clipboard event that is being handled: the copy or
 * cut the browser is performing. Taking the event's default away is what
 * makes the browser keep this text rather than the page's selected text.
 */
export function putOnClipboard(event: ClipboardEvent, text: string): boolean {
  lastCopied = text;
  const data = event.clipboardData;
  // Answers whether the clipboard took the text, so a Cut never removes
  // blocks that were not copied.
  if (data === null) return false;
  data.setData(BLOCK_CLIPBOARD_TYPE, text);
  data.setData("text/plain", text);
  event.preventDefault();
  return true;
}

/**
 * Copy text from a control, such as a menu's Copy, where no clipboard event
 * is under way. Answers whether the clipboard took it, now or once the
 * asynchronous clipboard has answered.
 *
 * Asks the document for a copy (`execCommand("copy")`), which the browser
 * allows during the click or keypress that chose the command, and fills the
 * copy event it raises; listened for on the window and in the capture phase,
 * so this write is the only one made. Where the browser does not run the
 * command, the asynchronous clipboard takes the plain text instead.
 */
export function writeToClipboard(
  doc: Document,
  text: string
): boolean | Promise<boolean> {
  lastCopied = text;
  const view = doc.defaultView;
  let written = false;
  const fill = (event: Event) => {
    if (!isClipboardEvent(event)) return;
    event.stopImmediatePropagation();
    written = putOnClipboard(event, text);
  };
  view?.addEventListener("copy", fill, true);
  try {
    doc.execCommand("copy");
  } catch {
    // A browser that refuses the command is answered by the fallback below.
  } finally {
    view?.removeEventListener("copy", fill, true);
  }
  if (written) return true;
  // The asynchronous clipboard answers later; a browser with none, or one
  // that refuses, answers that nothing was written.
  const clipboard = view?.navigator.clipboard;
  if (clipboard === undefined) return false;
  return clipboard.writeText(text).then(
    () => true,
    () => false
  );
}

/** The text a paste event carries that may be copied blocks, or nothing. */
export function textOfPaste(event: ClipboardEvent): string | undefined {
  const data = event.clipboardData;
  if (data === null) return undefined;
  const text = data.getData(BLOCK_CLIPBOARD_TYPE) || data.getData("text/plain");
  return text === "" ? undefined : text;
}

/**
 * The clipboard's text, for a menu's Paste: read from the system clipboard,
 * or the last copy made in this tab where the browser will not read it.
 */
export async function readClipboard(
  doc: Document
): Promise<string | undefined> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard === undefined) return lastCopied;
  try {
    return await clipboard.readText();
  } catch {
    return lastCopied;
  }
}

/**
 * Whether an event is a clipboard event, by its shape rather than its class:
 * a canvas frame's events are built by another window.
 */
export function isClipboardEvent(event: Event): event is ClipboardEvent {
  return "clipboardData" in event;
}
