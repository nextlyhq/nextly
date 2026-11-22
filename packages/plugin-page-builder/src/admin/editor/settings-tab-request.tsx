"use client";

/**
 * Opening Page settings at a given tab, and hearing it close: what a fix
 * found in Page settings (a plugin's tab, such as the SEO plugin's) needs.
 *
 * Page settings is drawn afresh each time it opens, so the tab asked for is
 * kept until the dialog takes it as its first tab. Each close is counted,
 * so what depends on the page's settings (the providers' page checks) is
 * asked again once the author leaves them.
 *
 * @module admin/editor/settings-tab-request
 */
import { createContext, useMemo, useRef, useState } from "react";

/** Asking Page settings for a tab, and hearing it close. */
export interface SettingsTabRequest {
  /** Opens Page settings at `tab`. */
  readonly ask: (tab: string) => void;
  /** The tab asked for, once: the dialog's first tab when it opens. */
  readonly take: () => string | undefined;
  /** How many times Page settings has closed. */
  readonly closed: number;
  /** Counts a close of Page settings. */
  readonly noteClosed: () => void;
}

/** The editor's request, for Page settings to read; none outside an editor. */
export const SettingsTabRequestContext: React.Context<SettingsTabRequest | null> =
  createContext<SettingsTabRequest | null>(null);

/** The editor's request, opening Page settings through `openSettings`. */
export function useSettingsTabRequestState(
  openSettings: () => void
): SettingsTabRequest {
  const pending = useRef<string | undefined>(undefined);
  const [closed, setClosed] = useState(0);
  return useMemo(
    () => ({
      ask: tab => {
        pending.current = tab;
        openSettings();
      },
      take: () => {
        const tab = pending.current;
        pending.current = undefined;
        return tab;
      },
      closed,
      noteClosed: () => setClosed(count => count + 1),
    }),
    [openSettings, closed]
  );
}
