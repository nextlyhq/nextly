/**
 * Where an Inbox item came from, in the words a row shows beside its time:
 * the area of the admin that wrote it ("Releases", "Workflows").
 *
 * A kind is namespaced by the feature that writes it (`releases.stopped`,
 * `workflows.assigned`), so its first segment names that feature; the row
 * shows it as a word, never as the key.
 *
 * @module components/features/notifications/notice-source
 */

/** The area an item's kind belongs to, as a row names it. */
export function noticeSource(kind: string): string {
  const namespace = kind.split(".")[0] ?? "";
  const words = namespace.replace(/[-_]+/g, " ").trim();
  if (words === "") return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
