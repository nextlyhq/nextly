/**
 * Whether a document's dialog is open, for the release actions a page
 * contributes to its editor.
 *
 * The router renders one page component for every document of a route, with
 * no key, so a hook called from the page survives a move from one document to
 * the next. A plain boolean would keep a dialog open over a document nobody
 * opened it for. So the state names the document it was opened for, and a
 * dialog is open only there.
 *
 * Leaving that document also forgets it: a dialog left open by navigating
 * away does not reappear, unasked, when the author comes back.
 *
 * @module components/features/releases/useOpenForDocument
 */
import { useState } from "react";

export function useOpenForDocument(documentKey: string): {
  open: boolean;
  setOpen: (next: boolean) => void;
} {
  const [openFor, setOpenFor] = useState<string | null>(null);
  // The document the last render was for. Updated during render, as React
  // adjusts state from a changed input, so the closed state is drawn on the
  // first render of the new document rather than after an effect.
  const [shownFor, setShownFor] = useState(documentKey);
  if (shownFor !== documentKey) {
    setShownFor(documentKey);
    setOpenFor(null);
  }
  return {
    open: openFor === documentKey,
    setOpen: next => setOpenFor(next ? documentKey : null),
  };
}
