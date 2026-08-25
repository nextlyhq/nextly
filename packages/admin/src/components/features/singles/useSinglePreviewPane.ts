"use client";

/**
 * The in-place preview wiring for a Single, as one decision rather than five
 * scattered through the form.
 *
 * The same argument `useSinglePreviewLink` makes for the shareable link, and it
 * applies harder here because the parts are only correct TOGETHER: whether the
 * pane may be offered, whether the header may draw a toggle for it, which
 * document it points at, and what makes it refresh. Left in the form those were
 * two copies of one condition and a piece of state read three lines apart —
 * and a toggle offered where the pane is withheld is a button that flips a flag
 * nothing reads, while a pane opened where the toggle is absent is a split view
 * with no way back.
 *
 * It deliberately does NOT own the save count. That is bumped by the submit
 * handler, which the form declares long before it reaches any of this, so the
 * count is passed in — a hook that owned it would have to be called earlier
 * than its own inputs exist.
 *
 * @module components/features/singles/useSinglePreviewPane
 */

import { useCallback, useState } from "react";

import { previewRevisionOf } from "@admin/components/features/entries/PreviewMode/previewRevision";
import type { SelfPreviewScope } from "@admin/hooks/useEntryPreview";

import type { SinglePreviewLink } from "./useSinglePreviewLink";

export interface SinglePreviewPaneInput {
  /** The shareable-link decision, which already resolved the language. */
  link: SinglePreviewLink;
  /** The Single as last read, which the revision derives from. */
  document: unknown;
  /** How many times this form has saved. See the module note. */
  savedCount: number;
  /** Whether the editor is currently split for translation. */
  inTranslationMode: boolean;
}

export interface SinglePreviewPane {
  /** Whether the pane should render. */
  open: boolean;
  /** Close it. */
  onClose: () => void;
  /** The document it previews — the SAME scope the shareable link mints. */
  scope: SelfPreviewScope;
  /** What the preview would render, as a value that changes when it does. */
  revision: string;
  /**
   * The header's toggle props, ready to spread.
   *
   * EMPTY when the pane cannot be offered, because the header draws its button
   * purely on `onTogglePreviewPane` being present — so absence is how the
   * control is withheld, and returning it as a spreadable object keeps that
   * decision here rather than repeating the condition at the call site.
   */
  toggle:
    | { onTogglePreviewPane: () => void; previewPaneOpen: boolean }
    | Record<string, never>;
}

export function useSinglePreviewPane({
  link,
  document,
  savedCount,
  inTranslationMode,
}: SinglePreviewPaneInput): SinglePreviewPane {
  const [open, setOpen] = useState(false);

  /*
   * Withheld in translation mode for the reason the entry editor withholds it
   * there: that mode already splits the editor, and a third pane inside it
   * would nest two resizable groups and two chrome requests that disagree about
   * how much of the admin is left.
   *
   * Otherwise offered on exactly the terms the shareable link is, because both
   * need the same thing — a draft lifecycle and a resolvable language — and a
   * second answer to that question would drift from the first.
   */
  const canOffer = link.isAvailable && !inTranslationMode;

  const onClose = useCallback(() => setOpen(false), []);
  const onToggle = useCallback(() => setOpen(o => !o), []);

  return {
    // Both halves: a pane left open when the language stops resolving must
    // close rather than go on rendering a credential nothing would re-mint.
    open: open && canOffer,
    onClose,
    scope: link.scope,
    /*
     * The SAME builder the entry editor uses, and both of its halves matter.
     * Deriving from the document catches writes nobody announced — discarding a
     * working draft persists through its own mutation and moves no timestamp —
     * while the save count catches announced writes that move nothing the
     * document exposes, which is every status-less save of a published Single
     * after the first.
     */
    revision: previewRevisionOf(document, savedCount),
    toggle: canOffer
      ? { onTogglePreviewPane: onToggle, previewPaneOpen: open }
      : {},
  };
}
