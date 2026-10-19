"use client";

/**
 * The not-found page in place of a document's screen, when the address names
 * a plugin document view that does not apply to the document — one offered on
 * a field type the document has no top-level field of.
 *
 * A component rather than an early return in each page, so the pages that host
 * a view gain no branch of their own: the decision is `documentViewMissing`'s,
 * and this only draws it.
 *
 * @module components/features/entries/EntryForm/DocumentViewGate
 */
import type { ReactNode } from "react";

import { NotFoundPage } from "@admin/components/shared/not-found-page";

export function DocumentViewGate({
  missing,
  children,
}: {
  /** Whether the routed view does not apply to this document. */
  missing: boolean;
  children: ReactNode;
}): ReactNode {
  return missing ? <NotFoundPage /> : children;
}
