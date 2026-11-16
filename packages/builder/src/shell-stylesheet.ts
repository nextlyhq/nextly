/**
 * The design system's stylesheet the shell draws with: checked for on the
 * host page, and the side panels' class.
 *
 * @module shell-stylesheet
 */
import * as React from "react";

import { devWarnOnce } from "./dev-warn";

/**
 * One design-system token, read off the mounted shell.
 *
 * Chosen over any `--nx-builder-*` because those are declared in this package's
 * own stylesheet and would resolve whether or not the design system's had been
 * loaded — the check would pass in exactly the case it exists to catch. The
 * `--nx-*` layer is declared only by `@nextlyhq/ui`, so its absence is the
 * question being asked.
 */
const REQUIRED_HOST_TOKEN = "--nx-background";

/**
 * A token this package's OWN stylesheet declares, used as a positive control.
 *
 * Without it the check cannot tell the two ways of resolving to nothing apart:
 * a host that never imported the design system's sheet, and an environment that
 * applies no stylesheets whatsoever. jsdom is the second, so a bare absence test
 * would warn on every unit test that mounts the shell — noise indistinguishable
 * from the real defect, in the place developers read warnings most.
 *
 * Reading both makes the instrument observable: when this one resolves, styles
 * ARE being applied, and the other one's absence means what it says.
 */
const OWN_STYLESHEET_TOKEN = "--nx-builder-surface";

/**
 * The one surface both sides of the editor sit on, the rail's own: the left
 * panels and the Inspector are the panel surface around the canvas's grey
 * well, divided from it by the resize handle's single line. One class, so the
 * two sides cannot drift apart.
 */
export const SIDE_PANEL_CLASS =
  "bg-[color:var(--nx-builder-panel)] h-full overflow-auto";

/**
 * The resize handles between a side panel and the canvas: their 1px line in
 * the divider token, which turns to the foreground under more contrast and to
 * the system's text colour in forced colours (the base partial).
 */
export const PANEL_DIVIDER_CLASS =
  "nx-builder-divider-line bg-[color:var(--nx-builder-divider)]";

/**
 * Tell a developer when the design system's stylesheet has not been loaded.
 *
 * The editor's own sheet supplements that one rather than restating it, so a
 * host that imports only `@nextlyhq/builder/styles.css` gets a shell that mounts
 * with every class name in place and renders wrong — unstyled tooltips and drag
 * handles, and chrome colours resolving to nothing. Nothing at build time can
 * see a missing side-effect import in someone else's application, so this is the
 * only layer the requirement can be enforced from.
 */
export function useDesignSystemStylesheet(
  rootRef: React.RefObject<HTMLElement | null>
): void {
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const styles = window.getComputedStyle(root);
    const own = styles.getPropertyValue(OWN_STYLESHEET_TOKEN).trim();
    // Nothing resolves here, so the absence of the other token says nothing
    // about the host. Reporting it anyway would put a warning about a missing
    // import in front of every developer running the suite.
    if (own === "") return;
    devWarnOnce(
      styles.getPropertyValue(REQUIRED_HOST_TOKEN).trim() !== "",
      `The design system's stylesheet is not loaded, so the editor will render ` +
        `without its colours, tooltips or drag handles. Import ` +
        `"@nextlyhq/ui/styles.css" (or the admin's stylesheet) alongside ` +
        `"@nextlyhq/builder/styles.css" — the editor's sheet supplements it and ` +
        `does not replace it.`
    );
  }, [rootRef]);
}
