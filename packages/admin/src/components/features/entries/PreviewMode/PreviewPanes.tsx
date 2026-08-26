"use client";

/**
 * The document being edited, beside the page it becomes.
 *
 * Serves a collection entry and a Single alike. Nothing below the scope prop
 * distinguishes them: both are one document with a draft, an address on the
 * site and a credential that reaches it, so a second pane for Singles would
 * have been a second implementation of the split, the chrome request, the
 * renewal timer and both refusal states.
 *
 * A WRAPPER rather than a second editor, for the reason `TranslationPanes` is
 * one: the document keeps the form it already had — same context, same unsaved
 * guard, same autosave, same save intent — and this puts a frame beside it. A
 * route of its own would duplicate all four and give the guard a second address
 * to learn.
 *
 * Inactive it renders `children` and nothing else: no wrapper element, no
 * suppression request, no credential minted. An editor who never opens the
 * preview gets the ordinary page, and that has to be true STRUCTURALLY rather
 * than by the styles happening to agree.
 *
 * ## Why this asks for the page frame and nothing else
 *
 * The editor's measure is a 56rem column, declared by `MeasuredPageFrame`, and
 * two panes cannot share it. The frame is released the way the page builder
 * releases it — by asking, from inside — rather than by the page passing a
 * different width: `MeasuredPageFrame` states that framed and immersive are the
 * whole vocabulary, and a third value would be a second way to answer a
 * question it already answers.
 *
 * The admin's NAVIGATION stays. This is an auxiliary pane rather than a
 * takeover: an author opening a preview has not left the admin, and taking the
 * rail would make the editor behave like the page builder for a control that is
 * closed again a moment later.
 *
 * @module components/features/entries/PreviewMode/PreviewPanes
 */

import { useEffect, useRef, type ReactNode } from "react";

import { useSuppressAdminChrome } from "@admin/components/layout/ChromeSuppression";
import type {
  PreviewDocumentNoun,
  SelfPreviewScope,
} from "@admin/hooks/useEntryPreview";

import { PreviewFrame } from "./PreviewFrame";
import { PreviewSplit } from "./PreviewSplit";
import { usePreviewFrame, type UsePreviewFrameResult } from "./usePreviewFrame";

export interface PreviewPanesProps {
  /** Whether the preview side is shown. Closed, the editor renders untouched. */
  open: boolean;
  /** Close the pane. Rendered by this component, so it cannot be forgotten. */
  onClose: () => void;
  /**
   * The document to preview: a collection entry, or a Single.
   *
   * One prop rather than three, because the pane does not care which kind it
   * is — everything below this line is identical for both — and three loose
   * strings would let a caller name a collection AND a single, which is not a
   * narrower request but a different document.
   */
  scope: SelfPreviewScope;
  /** The document type's own word for its preview. */
  label: string;
  /**
   * What the preview would render, as a value that changes when it does.
   *
   * Both DERIVED from the document and COUNTED from the form's own saves,
   * because each kind of evidence is blind where the other sees. Deriving
   * catches writes nobody announced — discarding a working draft and restoring
   * a version each persist through their own mutation, so a token bumped only
   * by the submit handler leaves the frame showing content that was just
   * discarded. Counting catches the opposite: a status-less save of a published
   * entry writes the draft sidecar and moves nothing the document exposes, so
   * every save after the first is invisible to derivation alone.
   *
   * {@link previewRevisionOf} builds it. Passed in rather than computed here so
   * the pane stays a layout: the facts it is made of belong to the form that
   * holds the document.
   */
  revision: string;
  children: ReactNode;
}

export function PreviewPanes({
  open,
  onClose,
  scope,
  label,
  revision,
  children,
}: PreviewPanesProps) {
  /*
   * ONE component in both states, and the editor at ONE position in the tree.
   *
   * This used to return `children` alone when closed and a different component
   * when open, which put the editor under a different element type at a
   * different depth — so React unmounted and remounted the whole editor on
   * every toggle. Anything a field held that had not reached the form went with
   * it, silently: a field that keeps a temporarily invalid value locally,
   * precisely so it does not publish nonsense to the form, loses that value the
   * moment someone clicks Preview.
   *
   * Nothing about what a closed pane COSTS has changed, and each half is now
   * expressed directly rather than as a side effect of not rendering:
   */
  useSuppressAdminChrome({
    /*
     * No layers while closed, which registers nothing — `ChromeSuppression`
     * treats an empty list as no request — so a closed pane still leaves the
     * page measure exactly as it found it.
     *
     * `canExit` stays true and honest either way: the frame renders its own
     * close control, so the claim remains correct while it is open and is not
     * read at all while it is not.
     */
    layers: open ? ["pageFrame"] : [],
    canExit: true,
  });

  /*
   * `active` is what stops a closed pane costing anything: no credential is
   * minted, no audit row is written, no renewal timer is scheduled.
   *
   * It carries what the MOUNTING used to say. While this component existed
   * only when the pane was open, `true` was the same statement; it stays
   * mounted now so the editor beside it is not torn down, and the flag is what
   * keeps a closed pane silent.
   */
  const frame = usePreviewFrame({ scope, active: open });

  return (
    <PreviewSplit
      open={open}
      label={label}
      preview={
        <PreviewFrameOnSave
          frame={frame}
          revision={revision}
          onClose={onClose}
          label={label}
          // Derived from the scope rather than passed in beside it: two answers
          // to "which kind of document is this" would be one answer too many.
          noun={scope.single === undefined ? "entry" : "single"}
        />
      }
    >
      {children}
    </PreviewSplit>
  );
}

/**
 * Turns "what the preview would render has changed" into "show it again".
 *
 * Its own component so the effect that watches the revision sits beside the frame
 * it refreshes rather than in the layout above.
 *
 * The first value is REMEMBERED rather than acted on. The frame has just minted
 * and loaded when the pane opens, and treating the token's initial value as a
 * save would load the same page a second time on every open — visible as a
 * flash, and a wasted render of the site.
 */
function PreviewFrameOnSave({
  frame,
  revision,
  onClose,
  label,
  noun,
}: {
  frame: UsePreviewFrameResult;
  revision: string;
  onClose: () => void;
  label: string;
  noun: PreviewDocumentNoun;
}) {
  const { refresh } = frame;
  const lastSeen = useRef(revision);

  useEffect(() => {
    if (lastSeen.current === revision) return;
    lastSeen.current = revision;
    refresh();
  }, [revision, refresh]);

  return (
    <PreviewFrame {...frame} onClose={onClose} label={label} noun={noun} />
  );
}

export { PreviewFrame };
