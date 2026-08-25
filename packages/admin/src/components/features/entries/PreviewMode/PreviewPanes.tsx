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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@admin/components/ui";
import type {
  PreviewDocumentNoun,
  SelfPreviewScope,
} from "@admin/hooks/useEntryPreview";

import { PreviewFrame } from "./PreviewFrame";
import { usePreviewFrame, type UsePreviewFrameResult } from "./usePreviewFrame";

export interface PreviewPanesProps {
  /** Whether the pane is open. Closed renders `children` untouched. */
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

export function PreviewPanes({ open, children, ...rest }: PreviewPanesProps) {
  if (!open) return <>{children}</>;
  return <ActivePreviewPanes {...rest}>{children}</ActivePreviewPanes>;
}

/**
 * A separate component so the chrome request and the mint run only while the
 * pane is open — the same split `TranslationPanes` and `BlocksField` both make.
 * Calling either from the wrapper would release the page frame for every entry
 * whether or not anyone asked, and mint a credential for a pane nobody opened.
 */
function ActivePreviewPanes({
  onClose,
  scope,
  label,
  revision,
  children,
}: Omit<PreviewPanesProps, "open">) {
  /*
   * `pageFrame` alone. The rail, the sidebars and the header stay: this is a
   * pane beside the editor, not a surface that took the window, and an author
   * who can still see the navigation has not been stranded by it.
   *
   * `canExit` is nonetheless true and honest — the frame renders its own close
   * control — so the claim stays correct if this ever asks for the rail too.
   */
  useSuppressAdminChrome({ layers: ["pageFrame"], canExit: true });

  const frame = usePreviewFrame({ scope, active: true });

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      // Percentage STRINGS: this library reads a bare number as pixels, so
      // `defaultSize={55}` would be a 55-pixel pane rather than 55 percent.
    >
      <ResizablePanel id="entry-editor" minSize="35%" defaultSize="55%">
        {/*
         * `@container/content` is declared HERE, and it is what stops the
         * editor laying itself out against the page while rendering into half
         * of it. The dashboard's `<main>` carries that container and stays
         * full-page width, so without this every `@4xl/content:` query inside
         * the form measures the window: the document rail is placed beside a
         * column that no longer has room for it and overflows the pane.
         */}
        <div className="@container/content h-full overflow-y-auto">
          {/* The pane stands in for `PageContainer`, so it owes the same
              horizontal inset — and stops owing it where the editor's own
              columns go edge-to-edge. On an INNER element because a container
              cannot query itself. */}
          <div className="px-4 @sm/content:px-6 @2xl/content:px-8 @4xl/content:px-0">
            {children}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle withGrip />
      <ResizablePanel id="entry-preview" minSize="25%">
        <PreviewFrameOnSave
          frame={frame}
          revision={revision}
          onClose={onClose}
          label={label}
          // Derived from the scope rather than passed in beside it: two answers
          // to "which kind of document is this" would be one answer too many.
          noun={scope.single === undefined ? "entry" : "single"}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
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
