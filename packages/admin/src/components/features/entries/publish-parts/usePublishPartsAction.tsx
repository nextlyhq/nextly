"use client";

/**
 * "Choose what to publish…" on the editor's Publish split: the languages of a translated document,
 * and separately its shared fields, each chosen on its own, with what each will do read from the
 * server before anything goes live.
 *
 * Contributed by the page, as Schedule is, so the editor's action model places it on the primary
 * action's arrow and draws its reason when it is held. Offered for a saved document with a
 * publish lifecycle, held, with the reason, for a person who may not publish it. The editor's
 * Publish opens the same dialog where publishing changes more than the language on screen.
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
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { ReviewStateAnswer } from "@admin/types/workflows";

import { useOpenForDocument } from "../../releases/useOpenForDocument";
import { PUBLISH_WITHOUT_REVIEW_ACTION_ID } from "../EntryForm/document-actions";
import type { LanguageLabel } from "../publishAllOutcomes";

import type { TranslationOverview } from "./out-of-date";
import { defaultPartsChoice, type PartsChoice } from "./publish-parts-choice";
import {
  PublishPartsDialog,
  type PartsDialogOpener,
  type PublishReview,
} from "./PublishPartsDialog";

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
  /** The document's translation overview, where the person may read it. */
  overview?: TranslationOverview;
  /** Told, once a publish from the dialog is done, which languages went live. */
  onPublished?: (result: { published: readonly string[] }) => void;
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
  /**
   * Opens the dialog at `choice`; does nothing while it is open, or where the action does not
   * apply. `sharedPending` says the shared fields hold changes a save made a moment ago, which
   * the editor's read may not show yet; it stands for as long as that dialog is open.
   */
  open: (
    choice: PartsChoice,
    openedBy: PartsDialogOpener,
    opening?: { sharedPending?: boolean }
  ) => void;
}

/** One opening of the dialog. */
interface Opening {
  /** Each opening starts afresh: a new key mounts a new choice. */
  key: number;
  choice: PartsChoice;
  openedBy: PartsDialogOpener;
  sharedPending: boolean;
  /** Whether it asks the reason to publish without review first. */
  asksReason: boolean;
}

/** The document a review is kept for; a Single is named by its slug alone. */
function reviewDocumentOf(target: PartsTarget): ReleaseDocumentRef {
  return {
    scopeKind: target.kind,
    scopeSlug: target.slug,
    entryId: target.kind === "collection" ? target.id : "",
  };
}

function documentKeyOf(target: PartsTarget | undefined): string {
  if (target === undefined) return "none";
  return target.kind === "collection"
    ? `collection:${target.slug}:${target.id}`
    : `single:${target.slug}`;
}

/** The workflow governing the document, as the dialog reads it, where one is attached. */
function publishReviewOf(
  document: ReleaseDocumentRef | undefined,
  answer: ReviewStateAnswer | undefined
): PublishReview | undefined {
  if (document === undefined || answer?.attached !== true) return undefined;
  return {
    document,
    parts: answer.review.parts,
    mayPublishWithoutReview: answer.review.mayPublishWithoutReview,
  };
}

/**
 * Whether publishing without review is offered: only to a person the server lets publish past the
 * workflow, and only while some part of the document waits for approval. Otherwise there is no
 * review to skip, and Publish itself is the way.
 */
function offersWithoutReview(review: PublishReview | undefined): boolean {
  return (
    review?.mayPublishWithoutReview === true &&
    review.parts.some(part => part.stage !== null && !part.publishable)
  );
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
  overview,
  onPublished,
}: PublishPartsActionProps): PublishPartsAction {
  const canPublish = useCan(`publish-${target?.slug ?? ""}`);
  // The workflow's say, read from the same review state the header reads: what holds each part,
  // and whether this person may publish past it with a reason, as the server judges it.
  const reviewDocument =
    target === undefined ? undefined : reviewDocumentOf(target);
  const { data: reviewAnswer } = useReviewState(reviewDocument);
  // Open only for the document it was opened for, and closed by leaving it.
  const { open: isOpen, setOpen } = useOpenForDocument(documentKeyOf(target));
  const [opening, setOpening] = useState<Opening | null>(null);

  if (lifecycleEnabled !== true || target === undefined) {
    return {
      contributed: null,
      withoutReview: null,
      dialog: null,
      open: () => undefined,
    };
  }

  const openWith = (next: Omit<Opening, "key">) => {
    if (isOpen) return;
    setOpening(last => ({ ...next, key: (last?.key ?? 0) + 1 }));
    setOpen(true);
  };
  const openFromMenu = (asksReason: boolean) =>
    openWith({
      choice: defaultPartsChoice({
        languages,
        currentLocale,
        defaultLocale,
        sharedPending,
      }),
      openedBy: "menu",
      sharedPending: false,
      asksReason,
    });

  const contributed: ContributedAction = {
    action: {
      id: PUBLISH_PARTS_ACTION_ID,
      label: PUBLISH_PARTS_LABEL,
      placement: "publish-menu",
      ...(canPublish
        ? {}
        : { disabledReason: "You don't have permission to publish this." }),
    },
    binding: { onSelect: () => openFromMenu(false) },
  };

  const review = publishReviewOf(reviewDocument, reviewAnswer);
  const withoutReview: ContributedAction | null =
    canPublish && offersWithoutReview(review)
      ? {
          action: {
            id: PUBLISH_WITHOUT_REVIEW_ACTION_ID,
            label: PUBLISH_WITHOUT_REVIEW_LABEL,
            placement: "publish-menu",
          },
          binding: { onSelect: () => openFromMenu(true) },
        }
      : null;

  const dialog =
    opening === null ? null : (
      <PublishPartsDialog
        key={opening.key}
        open={isOpen}
        onOpenChange={setOpen}
        target={target}
        direction="publish"
        languages={languages}
        labelOf={labelOf}
        initialChoice={opening.choice}
        currentLocale={currentLocale ?? defaultLocale}
        // What the opening said stands; the editor's read catches up with it, or finds more.
        sharedPending={opening.sharedPending || sharedPending}
        openedBy={opening.openedBy}
        overview={overview}
        shown={shown}
        onDone={summary => toast.success(summary)}
        onPublished={onPublished}
        review={review}
        asksReason={opening.asksReason}
      />
    );

  return {
    contributed,
    withoutReview,
    dialog,
    open: (choice, openedBy, from) =>
      openWith({
        choice,
        openedBy,
        sharedPending: from?.sharedPending === true,
        asksReason: false,
      }),
  };
}
