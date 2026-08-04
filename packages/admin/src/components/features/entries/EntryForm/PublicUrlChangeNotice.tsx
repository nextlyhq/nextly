"use client";

import { useFormContext } from "react-hook-form";

import { cn } from "@admin/lib/utils";

/**
 * Says so when the pending slug edit will retire a live public address.
 *
 * Changing a published entry's slug is legitimate and stays available. What is not obvious from the
 * editor is that it retires the URL already sitting in links, feeds, sitemaps and search results,
 * and that nothing distinguishes it from renaming a draft. Most CMSs say nothing here; the cost of
 * silence is an author learning about it from a 404 somebody else hit.
 *
 * @module components/features/entries/EntryForm/PublicUrlChangeNotice
 */

/**
 * Whether the slug in the form differs from the one that is actually persisted.
 *
 * The baseline is the form's default values, not a value captured on first render. Defaults are
 * re-seeded whenever the entry is re-read, so a saved change moves the baseline with it: the notice
 * clears once the new slug IS the public URL, and reappears if the field is then pointed back at
 * the old one, which is another change of address rather than a return to safety. A captured ref
 * gets both of those backwards, and keeps showing a warning about an edit that already landed.
 */
export function usePublicUrlWillChange(
  slugName: string,
  active: boolean
): boolean {
  const form = useFormContext();
  const liveValue = form?.watch(slugName);
  const persisted = form?.formState.defaultValues?.[slugName];

  if (!active) return false;
  return (
    typeof liveValue === "string" &&
    typeof persisted === "string" &&
    liveValue !== persisted
  );
}

export interface PublicUrlChangeNoticeProps {
  /** Form field holding the slug. */
  slugName: string;
  /** Whether this entry has a public address at all (see `useHasPublicAddress`). */
  active: boolean;
  className?: string;
}

export function PublicUrlChangeNotice({
  slugName,
  active,
  className,
}: PublicUrlChangeNoticeProps) {
  const willChange = usePublicUrlWillChange(slugName, active);
  if (!willChange) return null;
  return (
    <span
      className={cn("text-xs text-muted-foreground", className)}
      role="status"
    >
      Changes the public URL. The old one will stop working.
    </span>
  );
}
