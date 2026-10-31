/**
 * The card settings sheet's code, as one fetch, and the handlers that start it
 * ahead of an opening.
 *
 * Apart from `LazyWidgetSettingsSheet`, which draws the sheet once this has
 * arrived: a card's empty state and its menus only start the fetch, and every
 * card is drawn by `WidgetRenderer`, which the widget preview page shares with
 * the dashboard. Importing the drawing half from there carried the loading and
 * failure panel into every page that draws a card, though only customise mode
 * opens the sheet.
 *
 * @module components/features/widgets/edit/settings-sheet-code
 */

import {
  retryableModule,
  type RetryableModule,
} from "@admin/lib/retryable-module";

import type { WidgetSettingsSheet } from "./WidgetSettingsSheet";

/**
 * The sheet's code: one fetch shared by a preload and an opening, and, unlike
 * `React.lazy`, a failed fetch is not kept, so opening again fetches afresh
 * rather than throwing the dashboard into its error boundary.
 */
export const settingsSheetModule: RetryableModule<typeof WidgetSettingsSheet> =
  retryableModule(() =>
    import("./WidgetSettingsSheet").then(m => m.WidgetSettingsSheet)
  );

/**
 * Start fetching the sheet's code ahead of its opening. A failed fetch says
 * nothing here: opening the sheet asks again.
 */
export function preloadWidgetSettingsSheet(): void {
  settingsSheetModule.preload();
}

/**
 * The handlers that preload the sheet from a control that opens it, or opens the menu or
 * popover it is opened from: a pointer over it, or focus on it.
 */
export const settingsIntent = {
  onPointerEnter: preloadWidgetSettingsSheet,
  onFocus: preloadWidgetSettingsSheet,
} as const;
