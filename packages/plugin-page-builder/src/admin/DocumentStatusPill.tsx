"use client";

/**
 * Whether the page being edited is live, shown inside the editor.
 *
 * The editor takes the whole window and asks the admin to hide its chrome, so
 * the status the entry and Single editors show beside the form is not on screen
 * while an author is in here. Without this the only thing the top bar says is
 * "Save", which does not answer the question an author actually has: is what I
 * am looking at what a visitor sees?
 *
 * ## The saved page's state, and nothing about unsaved edits
 *
 * `useDocumentStatus` reports the persisted status of the language being
 * edited and whether a working draft is pending, and `savedPillState` turns
 * those into Draft, Published or Changed: the same rule, by the same function,
 * as the entry page's pill. Unsaved edits are not counted, because the save
 * chip beside it already says so; a pill that said it too ("Modified") gave
 * the bar two signals for one state.
 *
 * ## The words are shared and the colours are not
 *
 * The words come from the admin (`PILL_LABEL`, through `StatusPill`), so both
 * editors call the same state by the same name. The COLOURS are this
 * surface's own: the editor's chrome is drawn from `--nx-builder-*` tokens,
 * and borrowing the admin's warning palette would put a panel's colours on a
 * bar that is not that panel.
 *
 * @module @nextlyhq/plugin-page-builder/admin/DocumentStatusPill
 */

import { savedPillState, useDocumentStatus } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import { StatusPill } from "./status-pill";

/**
 * @returns the pill, or nothing when no surrounding form published a status
 */
export function DocumentStatusPill(): JSX.Element | null {
  const status = useDocumentStatus();
  // Nothing rather than a guess. A blocks field also renders inside a create
  // form and inside previews, where no status has been persisted — and a pill
  // reading "Draft" there would be a claim nobody made.
  if (status === null) return null;

  const state = savedPillState(status.status, status.hasWorkingDraft);
  // Named for a reader, because "Draft" alone in a toolbar does not say
  // what it describes.
  return <StatusPill state={state} subject="Page status" />;
}
