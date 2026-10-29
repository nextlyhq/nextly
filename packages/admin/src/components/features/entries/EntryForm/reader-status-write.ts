/**
 * What a held editor still writes for a user who may read the document but
 * not change it.
 *
 * @module components/features/entries/EntryForm/reader-status-write
 */
import type { EntryFormIntent } from "./useEntryForm";

/**
 * The status `intent` writes for a reader, or undefined where it writes
 * nothing. A publish and an unpublish change only the status, which their
 * own permissions judge, so a reader may send them, as the status alone.
 * Every other intent stores the form's content, which a reader may not.
 *
 * `refused` is a settled answer refusing the update; while it is not settled
 * (a language switch's answer on its way) nothing is sent. `writesHeld` is
 * any other hold on the document, a colleague's claim or a past version on
 * screen, which holds a publish as it holds a save.
 */
export function readerStatusWrite(
  intent: EntryFormIntent | undefined,
  { refused, writesHeld }: { refused: boolean; writesHeld: boolean }
): "published" | "draft" | undefined {
  if (!refused || writesHeld) return undefined;
  if (intent === "publish") return "published";
  if (intent === "unpublish") return "draft";
  return undefined;
}

/**
 * Whether a write of the status alone is held: wherever the editor's edits
 * are, except for a reader whose refusal is settled and whose document
 * nothing else holds. What `readerStatusWrite` sends, a surface offering a
 * status write (publishing every language) offers.
 */
export function statusWritesHeld({
  editsHeld,
  refused,
  writesHeld,
}: {
  editsHeld: boolean;
  refused: boolean;
  writesHeld: boolean;
}): boolean {
  return (
    editsHeld &&
    readerStatusWrite("publish", { refused, writesHeld }) === undefined
  );
}
