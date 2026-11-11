/**
 * System health's "Copy diagnostics": the report is built on the server
 * (`GET /api/dashboard/diagnostics`, super-admins only), and copied here.
 *
 * ## Copying a text that is still on its way
 *
 * Browsers let a page write to the clipboard only close to the click that asked
 * for it, and Safari only within it. So where the browser can take a clipboard
 * item whose text arrives later, the write starts at the click with the
 * report's request as its text; elsewhere the text is written once it arrives.
 *
 * A write the browser refuses, or that never answers (a permission prompt left
 * open), is "refused": the card then shows the report selected in Details, for
 * the reader to copy by hand. A report that could not be built is an error of
 * its own, and nothing is copied.
 */

import { protectedApi } from "@admin/lib/api/protectedApi";

import { isRecord } from "./answer-guards";

/** Where the report is built. */
export const DIAGNOSTICS_PATH = "/dashboard/diagnostics";

/** How long a write may stay unanswered, once the text is in, before it counts as refused. */
export const CLIPBOARD_WAIT_MS = 1500;

/** What the confirmation says once the report is on the clipboard. */
export const COPIED_MESSAGE =
  "Diagnostics copied. No passwords, keys or addresses are in it.";

/** What the reader is told when the clipboard refused the report. */
export const REFUSED_MESSAGE =
  "Couldn't copy here. The report is selected in Details: press Ctrl+C or ⌘C.";

/** What the reader is told when the report could not be built. */
export const UNBUILT_MESSAGE =
  "Couldn't build the diagnostics report. Try again.";

/** The report, as the server built it; anything else is a failure to build it. */
export async function fetchDiagnosticsReport(): Promise<string> {
  const answer = await protectedApi.get<unknown>(DIAGNOSTICS_PATH);
  if (!isRecord(answer) || typeof answer.report !== "string") {
    throw new Error("The diagnostics answer holds no report.");
  }
  return answer.report;
}

/** The clipboard calls this needs, as the browser offers them. */
interface ClipboardLike {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

/** Whether the browser takes a clipboard item whose text is still a promise. */
function takesPendingItems(
  clipboard: ClipboardLike
): clipboard is ClipboardLike & Required<Pick<ClipboardLike, "write">> {
  return (
    typeof clipboard.write === "function" &&
    typeof globalThis.ClipboardItem === "function"
  );
}

/** Starts the clipboard write for `text`, by the means the browser has. */
function startWrite(
  clipboard: ClipboardLike | undefined,
  text: Promise<string>
): Promise<void> {
  if (clipboard !== undefined && takesPendingItems(clipboard)) {
    const blob = text.then(value => new Blob([value], { type: "text/plain" }));
    return clipboard.write([new ClipboardItem({ "text/plain": blob })]);
  }
  const writeText = clipboard?.writeText;
  if (typeof writeText !== "function") {
    return Promise.reject(new Error("This browser has no clipboard here."));
  }
  return text.then(value => writeText.call(clipboard, value));
}

/**
 * Copies the text `text` resolves to: "copied", or "refused" when the
 * clipboard said no or did not answer in time once the text was in.
 *
 * @throws whatever `text` rejects with: the report could not be built.
 */
export async function copyReport(
  text: Promise<string>,
  clipboard: ClipboardLike | undefined = globalThis.navigator?.clipboard
): Promise<"copied" | "refused"> {
  let started: Promise<void>;
  try {
    started = startWrite(clipboard, text);
  } catch (refusal) {
    // A browser that throws rather than rejects (an item type it does not
    // take) has refused the write all the same.
    started = Promise.reject(refusal);
  }
  const write = started.then(
    () => "copied" as const,
    () => "refused" as const
  );
  // Rethrows a report that could not be built, before the write is judged.
  await text;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"refused">(resolve => {
    timer = setTimeout(() => resolve("refused"), CLIPBOARD_WAIT_MS);
  });
  try {
    return await Promise.race([write, late]);
  } finally {
    clearTimeout(timer);
  }
}
