"use client";

/**
 * The document side of reading a past version, as one host.
 *
 * The history panel publishes the chosen version through
 * `DocumentHistoryContext`; SOMEBODY has to hold that state, provide it, and
 * answer by drawing the version instead of the live document. Both document
 * editors do — the entry editor and the Single editor — and every piece of
 * that answer is the same: which arrival states render as the version, when a
 * restore may be offered, how the version's own body is laid out. Written
 * twice, the two editors would answer those questions separately and drift
 * while both looked correct, so the panel's counterpart lives here once and
 * each editor mounts it.
 *
 * @module components/features/versions/viewed-version-host
 */

import type { FieldConfig } from "nextly/config";
import { useMemo, useState, type ReactNode } from "react";

import { Alert, AlertDescription, Skeleton } from "@admin/components/ui";
import {
  computeMainFields,
  type TakeoverType,
} from "@admin/lib/builder/takeoverLayout";

import {
  useDocumentHistory,
  type DocumentHistoryValue,
  type RestoreAffordance,
  type ViewedVersion,
} from "./document-history-context";
import { HistoricalDocumentBanner } from "./HistoricalDocumentBanner";
import { snapshotToFormValues } from "./snapshot-to-form-values";
import { VersionSnapshotForm } from "./VersionSnapshotForm";

/**
 * Whether the chosen version is actually on screen.
 *
 * A read that has not returned leaves `isLoading` false with no error and no
 * snapshot: the query is disabled whenever the scope is not yet addressable,
 * and a paused one reports the same. Deciding from `isLoading` alone would
 * render an empty document as though it were the version, and offer to restore
 * what nobody has seen.
 */
function versionOnScreen(viewing: ViewedVersion): boolean {
  return (
    viewing.error === null &&
    !viewing.isLoading &&
    viewing.snapshot !== undefined
  );
}

/**
 * Whether the editor's write affordances are withheld: they act on the LIVE
 * document, which is not what is on screen while a version is being read, and
 * a colleague's claim refuses them the rest of the time. One answer for every
 * surface that offers a write — the header's actions, the rail, the language
 * panel — so none of them disagrees about when a write is offered.
 */
export function useWriteActionsHeld(baseDisabled: boolean): boolean {
  const { viewing } = useDocumentHistory();
  return viewing !== null || baseDisabled;
}

/**
 * Whether the editor's autosave may record a recovery point. Recording is for
 * editing: a real save in flight is about to change the document underneath
 * the snapshot, and a past version on screen is a document nobody is tending.
 * Reading is not editing.
 */
export function mayRecordRecovery(
  isSubmitting: boolean,
  viewing: ViewedVersion | null
): boolean {
  return !isSubmitting && viewing === null;
}

export interface ViewedVersionHost {
  /** The version on screen in place of the live document, or null for live. */
  viewingVersion: ViewedVersion | null;
  /** The context value the editor provides above its header and its body. */
  documentHistory: DocumentHistoryValue;
  /**
   * The body layout for the version on screen, from that version's own
   * values. The takeover layout is value-driven, so computing it from the live
   * document would show today's layout over yesterday's document — omitting
   * fields the version stored, or offering fields it never had. Null while
   * nothing is being read.
   */
  historicalFields: FieldConfig[] | null;
}

/**
 * Holds everything an editor needs to answer a published version, so each
 * editor states the wiring once and neither answers the panel differently.
 *
 * @param fields - every field the document declares, system fields included
 * @param takeoverTypes - the takeover field types, from the same source the
 *   live layout used
 */
export function useViewedVersion(
  fields: FieldConfig[],
  takeoverTypes: TakeoverType[]
): ViewedVersionHost {
  // Which past version the document area is showing, or null for the live
  // document. Held by the component that swaps the document, and published
  // downward because the panel that chooses it is mounted from the header,
  // several levels below.
  const [viewingVersion, setViewingVersion] = useState<ViewedVersion | null>(
    null
  );
  // Published by the history panel while it is mounted, so the banner can
  // offer restoring without a second copy of the permission or the mutation.
  const [restoreAffordance, setRestoreAffordance] =
    useState<RestoreAffordance | null>(null);
  const documentHistory = useMemo<DocumentHistoryValue>(
    () => ({
      viewing: viewingVersion,
      setViewing: setViewingVersion,
      restore: restoreAffordance,
      setRestore: setRestoreAffordance,
    }),
    [viewingVersion, restoreAffordance]
  );

  const historicalFields = useMemo(() => {
    if (!viewingVersion) return null;
    return computeMainFields(fields, {
      takeoverTypes,
      values: snapshotToFormValues(fields, viewingVersion.snapshot),
    });
  }, [viewingVersion, fields, takeoverTypes]);

  return { viewingVersion, documentHistory, historicalFields };
}

/**
 * The banner over the version being read, derived from the shared context.
 *
 * Renders nothing while no version is published, so the caller mounts it
 * unconditionally beside its other document notices.
 *
 * @param actionsDisabled - why every write is refused right now, whether by a
 *   colleague's claim or a submit in flight; a caller who may not write the
 *   live document is not offered a write into its past either
 */
export function ViewedVersionBanner({
  actionsDisabled,
}: {
  actionsDisabled: boolean;
}) {
  const { viewing, setViewing, restore } = useDocumentHistory();
  if (!viewing) return null;
  return (
    <HistoricalDocumentBanner
      versionNo={viewing.versionNo}
      locale={viewing.locale}
      // Routed through the panel when one is mounted, so its selection clears
      // with the shared state. The direct fallback keeps the banner working
      // without a panel.
      onReturnToCurrent={restore?.returnToCurrent ?? (() => setViewing(null))}
      // Offered only when the panel says this caller may write.
      onRestore={
        restore?.canRestore && !actionsDisabled ? restore.request : undefined
      }
      // And only once the version is actually on screen: restoring from a
      // skeleton, or from a failed read, is a decision made without having
      // seen what is being chosen.
      restoreDisabled={!versionOnScreen(viewing)}
    />
  );
}

/**
 * The document area: the version while one is published, the editor's own
 * body otherwise.
 *
 * Reading a past version replaces the document rather than opening beside it:
 * the question an editor is asking is how this page read then, and that is
 * answered by the page. The live form stays mounted underneath — the
 * historical values are rendered against a form of their own, so nothing
 * typed here is disturbed and nothing historical can reach a save.
 *
 * @param fields - the layout for the version, from the host's
 *   `historicalFields`
 * @param children - the live document's body, rendered only while nothing is
 *   being read
 */
export function ViewedVersionBody({
  fields,
  children,
}: {
  fields: FieldConfig[];
  children?: ReactNode;
}) {
  const { viewing } = useDocumentHistory();
  if (!viewing) return <>{children}</>;
  return (
    <div className="@4xl/content:p-8 pt-6">
      {viewing.error ? (
        // A failed read must not render as an empty document: that is a
        // different and wrong claim about the version.
        <Alert variant="destructive">
          <AlertDescription>This version could not be loaded.</AlertDescription>
        </Alert>
      ) : !versionOnScreen(viewing) ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <span className="sr-only" role="status">
            Loading version {viewing.versionNo}
          </span>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <VersionSnapshotForm fields={fields} snapshot={viewing.snapshot} />
      )}
    </div>
  );
}
