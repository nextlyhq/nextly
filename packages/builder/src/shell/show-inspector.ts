/**
 * Showing the inspector from a control in the shell's slots, for one that
 * takes the author to a block's setting (a page check's fix): the setting
 * opens in the inspector, so a hidden inspector is shown first. Lent by the
 * shell around its top bar; absent outside a shell, where there is no hidden
 * inspector to show.
 *
 * @module shell/show-inspector
 */
import * as React from "react";

/** Show the inspector, where it is hidden. */
export const ShowInspectorContext: React.Context<(() => void) | undefined> =
  React.createContext<(() => void) | undefined>(undefined);
