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

import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { useCan } from "@admin/hooks/useCan";

import { dialogOpenerOf } from "./dialog-opener";
import {
  SCHEDULE_PUBLISH_ACTION_ID,
  SCHEDULE_PUBLISH_LABEL,
  schedulePublishRefusal,
} from "./schedule-publish";

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
  /** The document's title, which names the release it goes into. */
  documentTitle: string | undefined;
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
}: SchedulePublishProps): SchedulePublishAction {
  // Both, because the server asks both: creating the release, and
  // scheduling it, which is what puts content live later.
  const canCreateReleases = useCan("create-content-releases");
  const canScheduleReleases = useCan("publish-content-releases");
  const canPublishDocument = useCan(`publish-${scopeSlug}`);
  /*
   * Which document the dialog is open for, rather than whether it is open.
   * The router keeps this page mounted from one document to the next, and a
   * plain boolean would reopen the dialog over a document nobody asked about.
   */
  const documentKey = `${scopeKind}:${scopeSlug}:${entryId}`;
  const [openFor, setOpenFor] = useState<string | null>(null);
  // Each opening starts afresh: a new key mounts a new form.
  const [opening, setOpening] = useState(0);
  // Where focus goes back to when the dialog closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const open = openFor === documentKey;

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
      onSelect: () => {
        setOpener(dialogOpenerOf(globalThis.document?.activeElement ?? null));
        setOpening(count => count + 1);
        setOpenFor(documentKey);
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
          onOpenChange={next => setOpenFor(next ? documentKey : null)}
          document={{ scopeKind, scopeSlug, entryId }}
          documentTitle={documentTitle}
          opener={opener}
        />
      </Suspense>
    );

  return { contributed, dialog };
}
