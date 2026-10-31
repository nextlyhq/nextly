"use client";

/**
 * A card's settings sheet, with its code loaded when a reader is about to
 * open it rather than with the dashboard.
 *
 * The sheet draws its form with the entry editor's field renderer, and that
 * renderer reaches the whole editor (a relationship field can create the entry
 * it links to, in the editor's own form). Imported statically, every dashboard
 * visit loaded the editor for a sheet most visits never open. Its code is
 * asked for on the first sign a reader is heading for it (`preloadWidgetSettingsSheet`:
 * a pointer over, or focus on, a control that opens it), so it has usually
 * arrived by the time it opens.
 *
 * @module components/features/widgets/edit/LazyWidgetSettingsSheet
 */

import { lazy, Suspense, type JSX } from "react";

import type { WidgetSettingsSheetProps } from "./WidgetSettingsSheet";

/** The sheet's module. The module loader fetches it once, so a preload and an opening share it. */
function loadSheet() {
  return import("./WidgetSettingsSheet");
}

const WidgetSettingsSheet = lazy(() =>
  loadSheet().then(m => ({ default: m.WidgetSettingsSheet }))
);

/**
 * Start fetching the sheet's code ahead of its opening. A failed fetch says
 * nothing here: opening the sheet asks again.
 */
export function preloadWidgetSettingsSheet(): void {
  loadSheet().catch(() => undefined);
}

/**
 * The handlers that preload the sheet from a control that opens it, or opens the menu or
 * popover it is opened from: a pointer over it, or focus on it.
 */
export const settingsIntent = {
  onPointerEnter: preloadWidgetSettingsSheet,
  onFocus: preloadWidgetSettingsSheet,
} as const;

/** {@link WidgetSettingsSheet}, drawn once its code has arrived; nothing before that. */
export function LazyWidgetSettingsSheet(
  props: WidgetSettingsSheetProps
): JSX.Element {
  return (
    <Suspense fallback={null}>
      <WidgetSettingsSheet {...props} />
    </Suspense>
  );
}
