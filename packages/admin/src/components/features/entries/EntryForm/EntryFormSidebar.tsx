"use client";

import type { JSX } from "react";

import { DocumentPanel } from "./panels";
import type { EntryFormMode, EntryData } from "./useEntryForm";

// into DocumentPanel; RevisionsPanel and ActivityPanel were
// "Coming soon" placeholders and removed entirely until those features ship
// with their own real surfaces.

export interface EntryFormSidebarProps {
  /** Form mode — DocumentPanel hides ID/Created/Updated/Status in create
   *  mode since the entry doesn't exist yet. */
  mode: EntryFormMode;
  /** Entry data — DocumentPanel reads id/status/timestamps. */
  entry?: EntryData | null;
  /** Whether sidebar should be hidden (embedded mode or rail collapsed). */
  hidden?: boolean;
  /** Whether this collection has Draft/Published status enabled, which the
   *  panel's language section reads. */
  hasStatus?: boolean;
  /** The active editing locale, forwarded to the language panel. */
  locale?: string;
  /** Switch the editor to a language, forwarded to the language panel. */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /** Withholds the language panel's mutating actions (reading a past version). */
  actionsDisabled?: boolean;
  /** Withholds opening another language; the same as `actionsDisabled` unless given. */
  navigationDisabled?: boolean;
}

export function EntryFormSidebar({
  mode,
  entry,
  hidden = false,
  hasStatus = false,
  locale,
  onLocaleChange,
  actionsDisabled = false,
  navigationDisabled = actionsDisabled,
}: EntryFormSidebarProps): JSX.Element | null {
  if (hidden) return null;

  return (
    <div className="h-full flex flex-col bg-background overflow-y-auto">
      <DocumentPanel
        mode={mode}
        entry={entry}
        hasStatus={hasStatus}
        {...(locale === undefined ? {} : { locale })}
        {...(onLocaleChange === undefined ? {} : { onLocaleChange })}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
      />
    </div>
  );
}
