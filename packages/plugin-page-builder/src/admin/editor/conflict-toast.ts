/**
 * The toast a shared-style or font save shows when it met someone else's
 * change to the same entry, with a Reload that reads the site's design again.
 *
 * A toast rather than a line in a panel because these saves answer many
 * small callers (the Shared styles tab, the inspector's class edits, the
 * Fonts tab), and a toast reaches the author whichever of them made the
 * save. A save merged cleanly shows nothing; the words are
 * `conflict-words`'.
 *
 * @module admin/editor/conflict-toast
 */
import { toast } from "@nextlyhq/ui";

import type { MergeableSection } from "../../site-style-merge";
import type { SaveConflicts } from "../../site-style-versioned-save";
import { conflictWords } from "../conflict-words";

/** How long the toast stays: long enough to read two sentences and act. */
const CONFLICT_TOAST_MS = 10_000;

/**
 * Tell the author about the true conflicts a save settled, if it settled
 * any. `reload` reads the site's design again and drops what the surface
 * holds of its own.
 */
export function toastSaveConflicts(
  section: MergeableSection,
  result: { readonly saved: boolean; readonly conflicts?: SaveConflicts },
  reload: () => void
): void {
  if (!result.saved) return;
  const words = conflictWords(section, result.conflicts);
  if (words === undefined) return;
  toast.warning(words, {
    duration: CONFLICT_TOAST_MS,
    action: { label: "Reload", onClick: reload },
  });
}
