"use client";

/**
 * The inspector's controls a lock holds, drawn read-only with the reason.
 *
 * @module held-by-lock
 */
import type * as React from "react";

/**
 * Controls a lock holds where the block sits, drawn as they are and disabled
 * together, pointing to the sentence that says why.
 *
 * A disabled fieldset rather than a flag threaded into every control: it
 * disables each form control inside it, the Style tab's and Advanced tab's
 * included, so no control can be missed, and a control added later is held
 * without knowing it is. The store refuses the same edits whatever the panel
 * draws; this says so before the author tries.
 */
export function HeldByLock({
  reasonId,
  children,
}: {
  /** The reason's element id; undefined when nothing is held. */
  reasonId: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  if (reasonId === undefined) return <>{children}</>;
  return (
    <fieldset
      disabled
      aria-describedby={reasonId}
      className="nx-inspector__held"
    >
      {children}
    </fieldset>
  );
}
