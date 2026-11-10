"use client";

/**
 * Wraps one contributed component, so what it does inside its own form stays
 * there.
 *
 * Places sit inside the document's own form on the edit pages: the editor
 * renders one `<form onSubmit>` around the whole document. React's `submit`
 * and `reset` events bubble through the component tree, so a plugin's own
 * form submitted inside a place would otherwise reach the document's handler
 * and save the document. Stopping them here keeps a plugin's submit its own.
 *
 * Only contributed components are wrapped, never a page's own parts, so a
 * page with nothing contributed has the DOM it had; `display: contents` keeps
 * the wrapper out of the layout where something is.
 *
 * @module components/shared/target-slot/IsolatedContribution
 */
import type { ReactNode, SyntheticEvent } from "react";

const stop = (event: SyntheticEvent) => event.stopPropagation();

export function IsolatedContribution({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div style={{ display: "contents" }} onSubmit={stop} onReset={stop}>
      {children}
    </div>
  );
}
