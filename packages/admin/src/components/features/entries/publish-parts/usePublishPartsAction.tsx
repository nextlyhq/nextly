"use client";

/**
 * "Choose what to publish…" on the editor's Publish split: the languages of a translated document,
 * and separately its shared fields, each chosen on its own, with what each will do read from the
 * server before anything goes live.
 *
 * Contributed by the page, as Schedule is, so the editor's action model places it on the primary
 * action's arrow and draws its reason when it is held. Offered for a saved document with a
 * publish lifecycle, held, with the reason, for a person who may not publish it.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/usePublishPartsAction
 */

import type { ReactNode } from "react";
import { useState } from "react";

import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { toast } from "@admin/components/ui";
import type { PartsTarget } from "@admin/hooks/queries/usePublishParts";
import { useReviewState } from "@admin/hooks/queries/useReviewState";
import { useCan } from "@admin/hooks/useCan";
import type { ShownCopy } from "@admin/lib/document-version";

import { useOpenForDocument } from "../../releases/useOpenForDocument";
import { PUBLISH_WITHOUT_REVIEW_ACTION_ID } from "../EntryForm/document-actions";
import type { LanguageLabel } from "../publishAllOutcomes";

import { defaultPartsChoice, type PartsChoice } from "./publish-parts-choice";
import { PublishPartsDialog, type PublishReview } from "./PublishPartsDialog";

/** The action's id, for tests and for a plugin replacing it. */
export const PUBLISH_PARTS_ACTION_ID = "publish-parts";

/** What the action says. */
export const PUBLISH_PARTS_LABEL = "Choose what to publish…";

/** What publishing past the workflow says, on the main button's menu. */
const PUBLISH_WITHOUT_REVIEW_LABEL = "Publish without review…";

export interface PublishPartsActionProps {
  /** The document; absent while the page is loading. */
  target: PartsTarget | undefined;
  /** Whether this document type has a publish lifecycle at all. */
  lifecycleEnabled: boolean | undefined;
  /** The site's languages, in order, where the document is translated; otherwise none. */
  languages: readonly string[];
  labelOf: LanguageLabel;
  /** The language on screen, or undefined for the default one. */
  currentLocale: string | undefined;
  defaultLocale: string | undefined;
  /** Whether the shared fields hold changes nobody has published yet. */
  sharedPending: boolean;
  /** The editor's copy, so a part changed since it was read is refused. */
  shown?: () => ShownCopy | undefined;
}

export interface PublishPartsAction {
  /** The action to contribute, or null when it does not apply. */
  contributed: ContributedAction | null;
  /**
   * "Publish without review…", or null where the person may not publish past
   * the workflow or nothing on the document waits for approval. It opens the
   * same dialog, asking the reason first.
   */
  withoutReview: ContributedAction | null;
  /** The dialog to mount, or null while it has never been opened. */
  dialog: ReactNode;
}

export function usePublishPartsAction({
  target,
  lifecycleEnabled,
  languages,
  labelOf,
  currentLocale,
  defaultLocale,
  sharedPending,
  shown,
}: PublishPartsActionProps): PublishPartsAction {
  const canPublish = useCan(`publish-${target?.slug ?? ""}`);
  // The workflow's say, read from the same review state the header reads: what holds each part,
  // and whether this person may publish past it with a reason, as the server judges it.
  const reviewDocument =
    target === undefined
      ? undefined
      : {
          scopeKind: target.kind,
          scopeSlug: target.slug,
          entryId: target.kind === "collection" ? target.id : "",
        };
  const { data: reviewAnswer } = useReviewState(reviewDocument);
  const documentKey =
    target === undefined
      ? "none"
      : target.kind === "collection"
        ? `collection:${target.slug}:${target.id}`
        : `single:${target.slug}`;
  // Open only for the document it was opened for, and closed by leaving it.
  const { open, setOpen } = useOpenForDocument(documentKey);
  // Each opening starts afresh: a new key mounts a new choice.
  const [opening, setOpening] = useState(0);
  const [initialChoice, setInitialChoice] = useState<PartsChoice | null>(null);
  // Whether this opening asks the reason to publish without review first.
  const [asksReason, setAsksReason] = useState(false);

  if (lifecycleEnabled !== true || target === undefined) {
    return { contributed: null, withoutReview: null, dialog: null };
  }

  const openDialog = (reasonFirst: boolean) => {
    if (open) return;
    setInitialChoice(
      defaultPartsChoice({
        languages,
        currentLocale,
        defaultLocale,
        sharedPending,
      })
    );
    setAsksReason(reasonFirst);
    setOpening(count => count + 1);
    setOpen(true);
  };

  const contributed: ContributedAction = {
    action: {
      id: PUBLISH_PARTS_ACTION_ID,
      label: PUBLISH_PARTS_LABEL,
      placement: "publish-menu",
      ...(canPublish
        ? {}
        : { disabledReason: "You don't have permission to publish this." }),
    },
    binding: { onSelect: () => openDialog(false) },
  };

  // Offered only to a person the server lets publish past the workflow, and
  // only while some part of the document waits for approval: otherwise there
  // is no review to skip, and Publish itself is the way.
  const withoutReview: ContributedAction | null =
    canPublish &&
    reviewAnswer?.attached === true &&
    reviewAnswer.review.mayPublishWithoutReview &&
    reviewAnswer.review.parts.some(
      part => part.stage !== null && !part.publishable
    )
      ? {
          action: {
            id: PUBLISH_WITHOUT_REVIEW_ACTION_ID,
            label: PUBLISH_WITHOUT_REVIEW_LABEL,
            placement: "publish-menu",
          },
          binding: { onSelect: () => openDialog(true) },
        }
      : null;

  const review: PublishReview | undefined =
    reviewAnswer?.attached === true && reviewDocument !== undefined
      ? {
          document: reviewDocument,
          parts: reviewAnswer.review.parts,
          mayPublishWithoutReview: reviewAnswer.review.mayPublishWithoutReview,
        }
      : undefined;

  const dialog =
    opening === 0 || initialChoice === null ? null : (
      <PublishPartsDialog
        key={opening}
        open={open}
        onOpenChange={setOpen}
        target={target}
        direction="publish"
        languages={languages}
        labelOf={labelOf}
        initialChoice={initialChoice}
        shown={shown}
        onDone={summary => toast.success(summary)}
        {...(review === undefined ? {} : { review })}
        asksReason={asksReason}
      />
    );

  return { contributed, withoutReview, dialog };
}
