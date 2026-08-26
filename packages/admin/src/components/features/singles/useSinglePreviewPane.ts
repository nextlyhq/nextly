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

import { useCallback, useEffect, useState } from "react";

import { previewRevisionOf } from "@admin/components/features/entries/PreviewMode/previewRevision";
import {
  declaredPreviewLabel,
  previewLabel,
} from "@admin/hooks/useEntryPreview";
import type { SelfPreviewScope } from "@admin/hooks/useEntryPreview";
import type { SingleAdminOptions } from "@admin/types/entities";

import type { SinglePreviewLink } from "./useSinglePreviewLink";

export interface SinglePreviewPaneInput {
  /**
   * The Single's admin block, for the word it calls its preview by.
   *
   * Taken here rather than read at the call site: this hook assembles every
   * prop the pane receives, so what to call the preview belongs with the rest
   * of them. Resolved beside the hook instead, the default would live in one
   * place and the pane's other inputs in another, and the two would drift the
   * first time either moved.
   */
  admin?: SingleAdminOptions;
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
  /** What to call the preview, defaulted where the Single names none. */
  label: string;
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
    | {
        onTogglePreviewPane: () => void;
        previewPaneOpen: boolean;
        /**
         * Present only where the Single declared one, so the control keeps its
         * own default — "Show preview" — rather than being handed a defaulted
         * value it cannot tell from an author's choice.
         */
        previewLabel?: string;
      }
    | Record<string, never>;
}

export function useSinglePreviewPane({
  link,
  document,
  savedCount,
  inTranslationMode,
  admin,
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

  /*
   * Availability disappearing CLOSES the pane rather than masking it.
   *
   * `open && canOffer` alone only hides it: the state stays true, so when
   * translation mode ends or the locale resolves again the pane springs back
   * open and mints a credential nobody asked for. An author who entered
   * translation mode with the preview open did not ask to reopen it on the way
   * out, and a credential is an audit row.
   */
  useEffect(() => {
    if (!canOffer) setOpen(false);
  }, [canOffer]);

  // Read through the SAME normalizer `previewLabel` uses, so the pane's title
  // and its opener cannot disagree about what counts as declared. Trimming here
  // separately made a whitespace-only label absent for the button and present —
  // as a blank title — for the pane.
  const declaredLabel = declaredPreviewLabel(admin?.preview);

  const onClose = useCallback(() => setOpen(false), []);
  const onToggle = useCallback(() => setOpen(o => !o), []);

  return {
    label: previewLabel(admin?.preview),
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
    /*
     * The label rides WITH the toggle rather than beside it, because the pane
     * and the button that opens it are one thing to an author: named apart,
     * the pane took the Single's word for itself while its opener still said
     * "Show preview", and the declared name was reachable only after clicking a
     * control that disagreed with it.
     *
     * The DECLARED value, not the defaulted one. `label` above defaults to
     * "Preview" because a pane's title needs a word; the button reads its label
     * into a sentence and needs the lowercase noun, so absent is what lets each
     * apply the default its own sentence takes.
     */
    toggle: canOffer
      ? {
          onTogglePreviewPane: onToggle,
          previewPaneOpen: open,
          ...(declaredLabel === undefined
            ? {}
            : { previewLabel: declaredLabel }),
        }
      : {},
  };
}
