/**
 * A panel kept mounted while it is hidden, so what is typed in it survives,
 * but not rendered again until it shows: a hidden panel draws nothing an
 * author sees, so a selection made while another tab shows costs none of it.
 *
 * @module kept-while-hidden
 */
import * as React from "react";

/** What every panel handed here is told: whether it is the one showing. */
interface ShownOrNot {
  readonly onScreen: boolean;
}

/**
 * `panel`, rendered again whenever it shows or is shown, and not at all while
 * it stays hidden.
 *
 * It renders once as it hides, which tells it it left the screen, and again
 * as it shows, with what it is handed then. While hidden it keeps what it
 * last drew, so a handler drawn then still acts for what it was drawn for.
 */
export function keptWhileHidden<P extends ShownOrNot>(
  panel: React.FunctionComponent<P>
): React.NamedExoticComponent<P> {
  return React.memo(
    panel,
    (before, after) => !before.onScreen && !after.onScreen
  );
}
