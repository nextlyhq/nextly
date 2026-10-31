"use client";

/**
 * "Schedule publish…" on the editor's Publish split: this document, live at
 * a time someone chooses, in a release holding only it.
 *
 * Contributed by the page, as Add to release is, because releases are a
 * feature of the page and not of the editor: the editor's action model places
 * it on the primary action's arrow and draws its reason when it is held.
 *
 * Offered to everyone editing a document with a publish lifecycle, and held,
 * with the reason, from a person who may not schedule releases or publish
 * this document. A person who reaches for scheduling and finds nothing cannot
 * tell a missing permission from a missing feature.
 *
 * @module components/features/releases/SchedulePublishAction
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
import { useOpenForDocument } from "./useOpenForDocument";

const SchedulePublishDialog = lazy(() =>
  import("./SchedulePublishDialog").then(module => ({
    default: module.SchedulePublishDialog,
  }))
);

export interface SchedulePublishProps {
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
   * The document's title, which names the release it goes into: read from
   * the document as the editor holds it when the action is chosen, so a
   * title typed and not yet saved is the one the release takes.
   */
  documentTitle: (document: DocumentAsEdited) => string | undefined;
  /**
   * Whether saving writes what readers see at once: a published document
   * whose collection or Single keeps no drafts. The dialog then says so
   * rather than promising later saves wait for the release.
   */
  savesGoLive: boolean;
}

export interface SchedulePublishAction {
  /** The action to contribute, or null when it does not apply at all. */
  contributed: ContributedAction | null;
  /** The dialog to mount, or null when there is no action. */
  dialog: ReactNode;
}

export function useSchedulePublishAction({
  scopeKind,
  scopeSlug,
  entryId,
  lifecycleEnabled,
  onDefaultLocale,
  documentTitle,
  savesGoLive,
}: SchedulePublishProps): SchedulePublishAction {
  // Both, because the server asks both: creating the release, and
  // scheduling it, which is what puts content live later.
  const canCreateReleases = useCan("create-content-releases");
  const canScheduleReleases = useCan("publish-content-releases");
  const canPublishDocument = useCan(`publish-${scopeSlug}`);
  // Open only for the document it was opened for, and closed by leaving it.
  const documentKey = `${scopeKind}:${scopeSlug}:${entryId}`;
  const { open, setOpen } = useOpenForDocument(documentKey);
  // Each opening starts afresh: a new key mounts a new form.
  const [opening, setOpening] = useState(0);
  // Where focus goes back to when the dialog closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // The title as it stood when the action was chosen.
  const [title, setTitle] = useState<string | undefined>(undefined);

  if (lifecycleEnabled !== true || !scopeSlug || !entryId) {
    return { contributed: null, dialog: null };
  }

  const disabledReason = schedulePublishRefusal({
    canSchedule: canCreateReleases && canScheduleReleases,
    canPublish: canPublishDocument,
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
        // Already open: a second form over the first would be a second
        // request while the first may still be out.
        if (open) return;
        setOpener(dialogOpenerOf(globalThis.document?.activeElement ?? null));
        setTitle(documentTitle(edited));
        setOpening(count => count + 1);
        setOpen(true);
      },
    },
  };

  // Not mounted, and so not loaded, until somebody first asks for it.
  const dialog =
    opening === 0 ? null : (
      <Suspense fallback={null}>
        <SchedulePublishDialog
          key={opening}
          open={open}
          onOpenChange={setOpen}
          document={{ scopeKind, scopeSlug, entryId }}
          documentTitle={title}
          savesGoLive={savesGoLive}
          opener={opener}
        />
      </Suspense>
    );

  return { contributed, dialog };
}
