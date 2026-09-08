/**
 * Which translation a version holds.
 *
 * A localized document captures a version per locale and every history view
 * interleaves them, so a row identified only by its number leaves an editor
 * unable to tell whether version 5 is the English or the French one.
 *
 * One component, used by every list that shows versions. The rule has three
 * parts a second copy would drift on — when to show anything, what to show,
 * and what the label falls back to — and two lists naming a language
 * differently is worse than either choice, because the reader cannot tell
 * whether the difference means something.
 *
 * The CODE is what shows, with the human label as its tooltip: the code is
 * short enough to sit in a dense row without truncating, and stays legible
 * beside a version number and a status.
 *
 * @module components/features/versions/VersionLocaleBadge
 */

import { Badge } from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";

export interface VersionLocale {
  /** Whether this version's language should be named at all. */
  show: boolean;
  /** The locale code, as stored on the version. */
  code: string | null;
  /** Its human label, falling back to the code, for tooltips and aria text. */
  label: string | null;
}

/**
 * The locale facts a version row needs, resolved once.
 *
 * Exported beside the component because a row's accessible name has to include
 * the language as text, and reading it from anywhere else would be the second
 * copy this module exists to prevent.
 */
export function useVersionLocale(locale: string | null): VersionLocale {
  const { enabled, getLocale } = useLocalization();
  const label = locale !== null ? (getLocale(locale)?.label ?? locale) : null;
  return { show: enabled && locale !== null, code: locale, label };
}

/** Nothing is rendered on a single-language install, or for a version that
 *  carries no locale — a badge there would carry no information. */
export function VersionLocaleBadge({ locale }: { locale: string | null }) {
  const { show, code, label } = useVersionLocale(locale);
  if (!show) return null;
  return (
    <Badge
      variant="outline"
      className="shrink-0 uppercase"
      title={label ?? undefined}
    >
      {code}
    </Badge>
  );
}
