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

import { EntryFormToolbarSlots } from "@admin/components/features/entries/EntryForm/EntryFormToolbarSlots";
import { ReadOnlyDocumentForm } from "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm";
import {
  EntryLocaleProvider,
  useEntryLocale,
  type EntryLocaleContextValue,
} from "@admin/components/features/entries/EntryLocaleContext";
import { TranslationFieldProvider } from "@admin/components/features/entries/TranslationMode/TranslationFieldContext";
import { Alert, AlertDescription, Skeleton } from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";
import {
  computeMainFields,
  type TakeoverType,
} from "@admin/lib/builder/takeoverLayout";
import { cn } from "@admin/lib/utils";

import {
  useDocumentHistory,
  type DocumentHistoryValue,
  type RestoreAffordance,
  type ViewedVersion,
} from "./document-history-context";
import { HistoricalDocumentBanner } from "./HistoricalDocumentBanner";
import { snapshotToFormValues } from "./snapshot-to-form-values";

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
 * surface that offers a write — the header's actions, the submission path,
 * the rail, the language panel — so none of them disagrees about when a write
 * is offered.
 *
 * Takes the published version rather than reading the context: the editors
 * call this in their own body, ABOVE the provider they render, where a
 * context read would return the default and report no version on screen even
 * while one is.
 */
export function writeActionsHeld(
  viewing: ViewedVersion | null,
  baseDisabled: boolean
): boolean {
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

/**
 * The locale context a snapshot renders under, derived from the editor's own.
 *
 * Presentation comes from the VERSION: a snapshot captured in Arabic is read
 * right-to-left even while the editor is in English — which is what the banner
 * above it names. Every seam that ACTS on the live editor is withheld: locale
 * switching, translation mode, the inline source hint, copy-from-language and
 * publish-every-language, because reading a version must not be able to write
 * to the document that is temporarily not on screen.
 */
function snapshotLocaleContext(
  outer: EntryLocaleContextValue,
  locale: string,
  defaultLocale: string | undefined,
  getLocale: (code: string | undefined) => { rtl?: boolean } | undefined
): EntryLocaleContextValue {
  return {
    ...outer,
    locale,
    rtl: getLocale(locale)?.rtl ?? false,
    isNonDefaultLocale: !!defaultLocale && locale !== defaultLocale,
    sourceValues: undefined,
    onLocaleChange: undefined,
    seedFromLocale: undefined,
    onSeedHandled: undefined,
    onEnterTranslationMode: undefined,
    fetchSourceValues: undefined,
    publishAllLanguages: undefined,
  };
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
  /**
   * The version's OWN values as the form reads them, over every field the
   * document declares — including condition controllers that
   * `historicalFields` filters out of the RENDERED set. A form built from the
   * filtered list alone would leave those controllers undefined and judge the
   * version's own conditional fields against values it never had. Also what a
   * held toolbar slot displays, so a mode-switch plugin labels the historical
   * body with the version's mode, not today's. Null while nothing is being
   * read.
   */
  historicalValues: Record<string, unknown> | null;
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

  // One normalization of the version's snapshot, over EVERY declared field.
  // The layout below renders a filtered subset of it; the form and the held
  // toolbar read the whole map, so condition controllers the layout omits
  // still hold the values the version stored.
  const historicalValues = useMemo(() => {
    if (!viewingVersion) return null;
    return snapshotToFormValues(fields, viewingVersion.snapshot);
  }, [viewingVersion, fields]);

  const historicalFields = useMemo(() => {
    if (!viewingVersion || !historicalValues) return null;
    return computeMainFields(fields, {
      takeoverTypes,
      values: historicalValues,
    });
  }, [viewingVersion, historicalValues, fields, takeoverTypes]);

  return {
    viewingVersion,
    documentHistory,
    historicalFields,
    historicalValues,
  };
}

/**
 * The controller value a takeover toolbar slot should DISPLAY while a past
 * version is on screen: the version's own value, because the hidden live
 * form's value would label the historical body with today's mode — the one
 * thing on screen that disagrees with the version below it. Undefined while
 * the live document is on screen, so the slot falls back to the live form.
 *
 * A version that never stored the controller resolves to NULL, not undefined:
 * an explicit override with no value, so the slot shows an empty mode rather
 * than silently falling back to the live form's — the two cases mean opposite
 * things and only differ by that one distinction.
 */
export function historicalToolbarValue(
  historicalValues: Record<string, unknown> | null,
  viewingVersion: ViewedVersion | null,
  controllerField: string
): unknown {
  return viewingVersion !== null
    ? (historicalValues?.[controllerField] ?? null)
    : undefined;
}

/**
 * The takeover mode switch, wired for both document editors at once.
 *
 * The plugin slot displays and writes the controller field, so while a past
 * version is on screen it needs the history-aware pair: the version's own
 * value to display, and a write callback that declines. Assembling that pair
 * here is what keeps the two editors from drifting back into hand-rolled
 * copies of it.
 */
function VersionAwareToolbarSlots({
  context,
  controllerField,
  writesHeld,
  viewingVersion,
  historicalValues,
}: {
  context: "collection" | "single";
  controllerField?: string;
  writesHeld: boolean;
  viewingVersion: ViewedVersion | null;
  historicalValues: Record<string, unknown> | null;
}) {
  return (
    <EntryFormToolbarSlots
      context={context}
      controllerField={controllerField}
      writesHeld={writesHeld}
      value={
        controllerField !== undefined
          ? historicalToolbarValue(
              historicalValues,
              viewingVersion,
              controllerField
            )
          : undefined
      }
    />
  );
}

/**
 * The toolbar slot element for one editor, with the history-aware wiring
 * applied. A factory rather than a component so the editor can embed it in
 * its header's `toolbarSlot` without remounting the plugin subtree.
 */
export function versionAwareToolbarSlots(
  host: ViewedVersionHost,
  baseDisabled: boolean,
  context: "collection" | "single",
  controllerField?: string
): ReactNode {
  return (
    <VersionAwareToolbarSlots
      context={context}
      controllerField={controllerField}
      writesHeld={writeActionsHeld(host.viewingVersion, baseDisabled)}
      viewingVersion={host.viewingVersion}
      historicalValues={host.historicalValues}
    />
  );
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
 * answered by the page. The live field tree stays mounted BENEATH the version,
 * hidden and inert — its form is a different one from the snapshot's, so
 * nothing typed here is disturbed and nothing historical can reach a save,
 * while rich-field components (a text editor's undo history, its selection)
 * survive the round trip back to the live document.
 *
 * @param fields - the RENDERED layout for the version, from the host's
 *   `historicalFields` — a subset of what the version stored
 * @param values - the version's full value map, from the host's
 *   `historicalValues`; the form is built from this so condition controllers
 *   the rendered layout omits still hold the values the version stored
 * @param children - the live document's body, hidden while a version is being
 *   read and rendered normally otherwise
 */
export function ViewedVersionBody({
  fields,
  values,
  children,
}: {
  fields: FieldConfig[];
  values?: Record<string, unknown>;
  children?: ReactNode;
}) {
  const { viewing } = useDocumentHistory();
  const outerLocale = useEntryLocale();
  const { getLocale, defaultLocale } = useLocalization();
  // A snapshot captured in another language is presented in that language —
  // the banner above it names the locale, so the fields must agree — while
  // every seam that acts on the live editor is withheld from the snapshot.
  const snapshotLocale =
    viewing && viewing.locale !== null
      ? snapshotLocaleContext(
          outerLocale,
          viewing.locale,
          defaultLocale,
          getLocale
        )
      : outerLocale;
  return (
    <>
      {/* The live field tree keeps ONE stable parent in both branches, and
          only the wrapper's hidden state toggles: moving the subtree in and
          out of a wrapper would change its React ancestry, which unmounts
          and remounts it — destroying exactly the rich field state (an
          editor's undo history, its selection) that hiding exists to
          preserve. Hidden removes the tree from the accessibility tree and
          from every pointer, so the read-only claim on the banner holds. */}
      <div
        aria-hidden={viewing ? true : undefined}
        className={cn(viewing && "hidden")}
      >
        {children}
      </div>
      {viewing ? (
        <div className="@4xl/content:p-8 pt-6">
          {viewing.error ? (
            // A failed read must not render as an empty document: that is a
            // different and wrong claim about the version.
            <Alert variant="destructive">
              <AlertDescription>
                This version could not be loaded.
              </AlertDescription>
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
            <EntryLocaleProvider value={snapshotLocale}>
              {/* No translation-field context: history is opened from inside
                  translation mode without the mode exiting, and an inherited
                  source would put a "use source" affordance on every historical
                  field — writing into the version this area claims is frozen.
                  Empty is the context's own answer for "offers nothing". */}
              <TranslationFieldProvider value={{}}>
                <ReadOnlyDocumentForm
                  fields={fields}
                  values={values ?? {}}
                  mode="edit"
                />
              </TranslationFieldProvider>
            </EntryLocaleProvider>
          )}
        </div>
      ) : null}
    </>
  );
}
