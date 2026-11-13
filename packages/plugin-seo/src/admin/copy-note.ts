/**
 * Copying a note for a developer, where a fix is in the site's code: to the
 * clipboard, said in a toast, or shown in the toast to copy by hand where
 * the clipboard can't be written (an address that is not secure, or a
 * policy refusing it). One way for every screen that hands one over.
 *
 * @module admin/copy-note
 */
import { toastMutationResult } from "@nextlyhq/plugin-sdk/admin";

/** Copy `note`, saying so, or show it where it can't be copied. */
export function copyNote(note: string): void {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard === undefined) {
    toastMutationResult(note, []);
    return;
  }
  void clipboard.writeText(note).then(
    () => toastMutationResult(`Copied: “${note}”`, []),
    () => toastMutationResult(note, [])
  );
}
