/**
 * The icons an author chose last, newest first, for the Icon control's
 * "Recent" row. Kept by the host's store (one per signed-in author), read
 * and written here, so the picker itself remembers nothing.
 *
 * @module recent-icons
 */
import type { PreferenceStore } from "./shell-state";

/** How many icons are remembered: the picker's one Recent row. */
const REMEMBERED = 8;

/** The remembered ids, newest first; empty when there are none or they are unreadable. */
export function readRecentIcons(
  store: PreferenceStore | undefined
): readonly string[] {
  if (store === undefined) return [];
  try {
    const raw = store.read();
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is string => typeof id === "string")
          .slice(0, REMEMBERED)
      : [];
  } catch {
    return [];
  }
}

/**
 * Remembers `id` as the newest, an earlier mention of it removed, and answers
 * the list now kept. A store that refuses the write (private browsing, a full
 * quota) still answers the list, so this session's Recent row is right.
 */
export function rememberIcon(
  store: PreferenceStore | undefined,
  list: readonly string[],
  id: string
): readonly string[] {
  const next = [id, ...list.filter(other => other !== id)].slice(0, REMEMBERED);
  try {
    store?.write(JSON.stringify(next));
  } catch {
    // Nothing to do: the row is remembered for this session only.
  }
  return next;
}
