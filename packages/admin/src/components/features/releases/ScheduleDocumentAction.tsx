"use client";

/**
 * "Schedule…" on the editor's Publish split: this document, put into a
 * release, on its own at a time, with an existing release or in a new one,
 * to go live or come down at that release's moment. The one way to schedule a
 * document from its editor.
 *
 * Contributed by the page, because releases are a feature of the page and not
 * of the editor: the editor's action model places it on the primary action's
 * arrow and draws its reason when it is held.
 *
 * Offered to a person who may create releases, editing a saved document with
 * a publish lifecycle, and held, with the reason, where this document refuses:
 * the reader may neither publish nor unpublish it, or is on a translation.
 *
 * @module components/features/releases/ScheduleDocumentAction
 */

import type { ReactNode } from "react";
import { lazy, Suspense, useState } from "react";

import type {
  ContributedAction,
  DocumentAsEdited,
} from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { useCan } from "@admin/hooks/useCan";

import { dialogOpenerOf } from "./dialog-opener";
import {
  SCHEDULE_PUBLISH_ACTION_ID,
  SCHEDULE_PUBLISH_LABEL,
  schedulePublishRefusal,
} from "./schedule-publish";
import type { ScheduleDocumentDialogProps } from "./ScheduleDocumentDialog";
import { useOpenForDocument } from "./useOpenForDocument";
import { useSchedulingInFlight } from "./useSchedulingInFlight";

const ScheduleDocumentDialog = lazy(() =>
  import("./ScheduleDocumentDialog").then(module => ({
    default: module.ScheduleDocumentDialog,
  }))
);

export interface ScheduleDocumentProps {
  scopeKind: "collection" | "single";
  /** Absent while the page is loading, as the document may be. */
  scopeSlug: string | undefined;
  entryId: string | undefined;
  /**
   * Whether this document type has a publish lifecycle. Without one there is
   * nothing for a release to publish, so the action is not offered at all.
   */
  lifecycleEnabled: boolean | undefined;
  /** Whether the editor is on the document's default locale. */
  onDefaultLocale: boolean;
  /**
   * The document's title, which names the release it goes into, asked when
   * the action is chosen. A page answers with the title as SAVED, the version
   * the release ships; the document as the editor holds it is passed for a
   * surface whose saved title is not otherwise in hand.
   */
  documentTitle: (document: DocumentAsEdited) => string | undefined;
  /**
   * Whether saving writes what readers see at once: a published document
   * whose collection or Single keeps no drafts. The dialog then says so
   * rather than promising later saves wait for the release.
   */
  savesGoLive: boolean;
  /**
   * The site's content languages where the document is translated (the site
   * has localization on and the collection or Single is localized), which a
   * release moves together; absent or one otherwise.
   */
  languages?: readonly string[];
}

export interface ScheduleDocumentAction {
  /** The action to contribute, or null when it does not apply at all. */
  contributed: ContributedAction | null;
  /** The dialog to mount, or null when there is no action. */
  dialog: ReactNode;
}

export function useScheduleDocumentAction({
  scopeKind,
  scopeSlug,
  entryId,
  lifecycleEnabled,
  onDefaultLocale,
  documentTitle,
  savesGoLive,
  languages,
}: ScheduleDocumentProps): ScheduleDocumentAction {
  // Every way makes or joins a release, which the server asks permission to
  // create releases for. Scheduling one on its own also asks permission to
  // schedule, which the dialog holds that way for.
  const canCreateReleases = useCan("create-content-releases");
  const canPublishDocument = useCan(`publish-${scopeSlug}`);
  const canUnpublishDocument = useCan(`unpublish-${scopeSlug}`);
  // Open only for the document it was opened for, and closed by leaving it.
  const documentKey = `${scopeKind}:${scopeSlug}:${entryId}`;
  const { open, setOpen } = useOpenForDocument(documentKey);
  const { inFlight: scheduling, inFlightNow } = useSchedulingInFlight({
    scopeKind,
    scopeSlug,
    entryId,
  });
  // Each opening starts afresh: a new key mounts a new form.
  const [opening, setOpening] = useState(0);
  // Where focus goes back to when the dialog closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // The title, and whether edits were unsaved, as they stood when the action
  // was chosen.
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [unsaved, setUnsaved] = useState(false);

  if (
    lifecycleEnabled !== true ||
    !scopeSlug ||
    !entryId ||
    !canCreateReleases
  ) {
    return { contributed: null, dialog: null };
  }

  const disabledReason = schedulePublishRefusal({
    scheduling,
    canChangeDocument: canPublishDocument || canUnpublishDocument,
    onDefaultLocale,
  });

  const contributed: ContributedAction = {
    action: {
      id: SCHEDULE_PUBLISH_ACTION_ID,
      label: SCHEDULE_PUBLISH_LABEL,
      placement: "publish-menu",
      ...(disabledReason === undefined ? {} : { disabledReason }),
    },
    binding: {
      onSelect: edited => {
        // Already open, or a request for this document still out, sent
        // from a dialog a move away and back has since closed: a second form
        // would be a second request while the first may still be out.
        if (open || inFlightNow()) return;
        setOpener(dialogOpenerOf(globalThis.document?.activeElement ?? null));
        setTitle(documentTitle(edited));
        setUnsaved(edited.dirty === true);
        setOpening(count => count + 1);
        setOpen(true);
      },
    },
  };

  const dialog = dialogFor(opening, {
    open,
    onOpenChange: setOpen,
    document: { scopeKind, scopeSlug, entryId },
    documentTitle: title,
    savesGoLive,
    opener,
    languages,
    hasUnsavedEdits: unsaved,
  });

  return { contributed, dialog };
}

/**
 * The dialog for the `opening`th time the action was chosen. Not mounted, and
 * so not loaded, until somebody first asks for it; each opening is keyed
 * apart, so it starts afresh.
 */
function dialogFor(
  opening: number,
  props: ScheduleDocumentDialogProps
): ReactNode {
  if (opening === 0) return null;
  return (
    <Suspense fallback={null}>
      <ScheduleDocumentDialog key={opening} {...props} />
    </Suspense>
  );
}
