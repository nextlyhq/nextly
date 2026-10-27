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

import { ArrowDown, ArrowUp } from "lucide-react";
import type { FieldConfig } from "nextly/config";
import { useMemo, useState, type ReactNode, type JSX } from "react";

import { EntryFormToolbarSlots } from "@admin/components/features/entries/EntryForm/EntryFormToolbarSlots";
import { ReadOnlyDocumentForm } from "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm";
import {
  EntryLocaleProvider,
  useEntryLocale,
  type EntryLocaleContextValue,
} from "@admin/components/features/entries/EntryLocaleContext";
import { TranslationFieldProvider } from "@admin/components/features/entries/TranslationMode/TranslationFieldContext";
import {
  Alert,
  AlertDescription,
  Button,
  Skeleton,
} from "@admin/components/ui";
import { useVersionDiff } from "@admin/hooks/queries/useVersions";
import { useLocalization } from "@admin/hooks/useLocalization";
import {
  computeMainFields,
  type TakeoverType,
} from "@admin/lib/builder/takeoverLayout";
import { cn } from "@admin/lib/utils";

import {
  ChangesLayoutProvider,
  ChangesLayoutToggle,
  layoutFor,
  useChangesLayoutPreference,
} from "./diff/changes-layout";
import {
  useDocumentHistory,
  type DocumentHistoryValue,
  type RestoreAffordance,
  type ViewedVersion,
} from "./document-history-context";
import { snapshotToFormValues } from "./snapshot-to-form-values";
import { useChangeNavigation } from "./useChangeNavigation";
import {
  useVersionActions,
  versionOnScreen,
  type VersionActions,
} from "./version-actions";
import {
  changeOrder,
  changesStateOf,
  diffForPair,
  versionChangesOf,
  type ChangesState,
  type VersionChanges,
} from "./version-changes";
import { VersionChangesForm } from "./VersionChangesForm";
import { VersionComparisonBar } from "./VersionComparisonBar";
import { WithheldFieldsProvider } from "./withheld-fields-context";

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
 * right-to-left even while the editor is in English, because that is how it
 * was written. Every seam that ACTS on the live editor is withheld: locale
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
  // Published by the history panel while it is mounted, so the version's own
  // actions can offer restoring without a second copy of the permission or the mutation.
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
 * A past version's actions on a phone: the moves through its changes, Back to
 * current and Restore…, in a bar at the bottom, under the thumb. Wider
 * screens carry the same actions in the title bar and the comparison bar.
 */
/**
 * Where the reader is among the changes, in the phone bar's few words. Says
 * "No changes" only once the comparison has answered; while it is read, or if
 * it failed, it says so rather than claiming the versions are the same.
 */
function phonePositionText(
  state: ChangesState,
  changed: number,
  position: number
): string {
  switch (state.kind) {
    case "reading":
      return "Reading…";
    case "failed":
      return "Not read";
    case "first":
      return "First version";
    case "ready":
      if (changed > 0) return `${position + 1} of ${changed}`;
      // Never "No changes" where the server found a difference.
      return state.whenNone === "system"
        ? "System fields only"
        : state.whenNone === "unseen"
          ? "None you can read"
          : "No changes";
  }
}

function VersionPhoneBar({
  actions,
  state,
  changed,
  position,
  onMove,
}: {
  actions: VersionActions;
  state: ChangesState;
  changed: number;
  position: number;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Version actions"
      className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-background px-3 py-2 sm:hidden"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Previous change"
        disabled={changed < 2}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="text-sm tabular-nums text-muted-foreground">
        {phonePositionText(state, changed, position)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Next change"
        disabled={changed < 2}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={actions.returnToCurrent}
      >
        Back to current
      </Button>
      {actions.restore ? (
        <Button
          type="button"
          size="sm"
          disabled={actions.restoreDisabled}
          onClick={actions.restore}
        >
          Restore…
        </Button>
      ) : null}
    </div>
  );
}

/** The comparison a version's changes are read from, or null for none. */
function baselineOf(viewing: ViewedVersion): number | null {
  return viewing.comparedWith.kind === "version"
    ? viewing.comparedWith.versionNo
    : null;
}

/**
 * What the version on screen changed against the one it is compared with,
 * read from the same comparison the comparison page draws.
 */
function useViewedChanges(viewing: ViewedVersion) {
  const from = baselineOf(viewing);
  const diff = useVersionDiff({
    scope: viewing.scope,
    from,
    to: viewing.versionNo,
    enabled: from !== null,
  });
  // Keyed on the pair: a diff kept on screen from the previous pair while
  // the next loads must not mark this version's fields.
  const data = diffForPair(diff.data, from, viewing.versionNo);
  const changes = useMemo(() => (data ? versionChangesOf(data) : null), [data]);
  const state = changesStateOf({
    comparedWith: viewing.comparedWith,
    failed: diff.isError,
    retry: () => void diff.refetch(),
    changes,
  });
  return { changes, state };
}

/** The top-level names a form lays out, in its order. */
function layoutNames(fields: readonly FieldConfig[]): string[] {
  return fields.flatMap(field =>
    "name" in field && typeof field.name === "string" ? [field.name] : []
  );
}

/**
 * The version's fields: its changes marked where they are known, the whole
 * version where they are not yet (or where it is the first), a skeleton while
 * it is read, and a plain refusal if it could not be.
 */
function VersionContent({
  viewing,
  fields,
  values,
  changes,
  order,
  current,
}: {
  viewing: ViewedVersion;
  fields: FieldConfig[];
  values: Record<string, unknown>;
  changes: VersionChanges | null;
  order: readonly string[];
  current: string | null;
}) {
  const outerLocale = useEntryLocale();
  const { getLocale, defaultLocale } = useLocalization();
  const [showUnchanged, setShowUnchanged] = useState(false);
  if (viewing.error) {
    // A failed read must not render as an empty document: that is a
    // different and wrong claim about the version.
    return (
      <Alert variant="destructive">
        <AlertDescription>This version could not be loaded.</AlertDescription>
      </Alert>
    );
  }
  if (!versionOnScreen(viewing)) {
    return (
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
    );
  }
  // A snapshot captured in another language is presented in that language,
  // while every seam that acts on the live editor is withheld from it.
  const snapshotLocale =
    viewing.locale !== null
      ? snapshotLocaleContext(
          outerLocale,
          viewing.locale,
          defaultLocale,
          getLocale
        )
      : outerLocale;
  return (
    <EntryLocaleProvider value={snapshotLocale}>
      {/* No translation-field context: history is opened from inside
          translation mode without the mode exiting, and an inherited source
          would put a "use source" affordance on every historical field —
          writing into the version this area claims is frozen. Empty is the
          context's own answer for "offers nothing". */}
      <TranslationFieldProvider value={{}}>
        {/* What the read held back, so a field whose value was withheld says
            so where the value would be. It wraps both forms: a field is
            withheld whether or not what changed has been read yet. */}
        <WithheldFieldsProvider paths={viewing.withheld}>
          {changes ? (
            <VersionChangesForm
              fields={fields}
              values={values}
              changes={changes}
              order={order}
              current={current}
              showUnchanged={showUnchanged}
              onToggleUnchanged={() => setShowUnchanged(v => !v)}
            />
          ) : (
            // Nothing to mark yet (the first version, or while what changed is
            // read): the version reads whole.
            <ReadOnlyDocumentForm fields={fields} values={values} mode="edit" />
          )}
        </WithheldFieldsProvider>
      </TranslationFieldProvider>
    </EntryLocaleProvider>
  );
}

/**
 * One version on screen: its comparison bar, its fields, and on a phone its
 * actions at the bottom. Keyed by the version, so choosing another starts at
 * its first change with its unchanged fields folded.
 */
function ViewedVersionFrame({
  viewing,
  fields,
  values,
  actionsDisabled,
}: {
  viewing: ViewedVersion;
  fields: FieldConfig[];
  values: Record<string, unknown>;
  actionsDisabled: boolean;
}) {
  const { restore } = useDocumentHistory();
  const actions = useVersionActions(actionsDisabled);
  const { changes, state } = useViewedChanges(viewing);
  const layout = useMemo(() => layoutNames(fields), [fields]);
  const order = useMemo(
    () => (changes ? changeOrder(changes, layout) : []),
    [changes, layout]
  );
  const { position, current, move } = useChangeNavigation(order);
  const [preference, setChangesLayout] = useChangesLayoutPreference();
  const { layout: changesLayout, splittable } = layoutFor(
    preference,
    changes?.byField.values() ?? []
  );
  return (
    // The reader's remembered layout, for every change drawn below.
    <ChangesLayoutProvider value={changesLayout}>
      {/* Room under the last field for the phone's bottom bar. The container
          the changes query, as on the comparison page: side by side, each
          change's two sides take columns only where this box has room. */}
      <div className="@container/diff @4xl/content:p-8 pt-6 pb-20 sm:pb-0">
        <VersionComparisonBar
          layoutToggle={
            order.length > 0 ? (
              <ChangesLayoutToggle
                layout={changesLayout}
                onChange={setChangesLayout}
                splittable={splittable}
              />
            ) : null
          }
          versionNo={viewing.versionNo}
          about={viewing.about}
          comparedWith={viewing.comparedWith}
          changes={state}
          position={position}
          onMove={move}
          onBackToHistory={restore?.backToHistory}
          onOpenComparison={restore?.compare}
          onCompareCurrent={restore?.compareCurrent}
        />
        <VersionContent
          viewing={viewing}
          fields={fields}
          values={values}
          changes={changes}
          order={order}
          current={current}
        />
        {actions ? (
          <VersionPhoneBar
            actions={actions}
            state={state}
            changed={order.length}
            position={position}
            onMove={move}
          />
        ) : null}
      </div>
    </ChangesLayoutProvider>
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
 * The version is framed by one comparison bar, and each field it changed is
 * marked; unchanged fields fold away until asked for.
 *
 * @param fields - the RENDERED layout for the version, from the host's
 *   `historicalFields` — a subset of what the version stored
 * @param values - the version's full value map, from the host's
 *   `historicalValues`; the form is built from this so condition controllers
 *   the rendered layout omits still hold the values the version stored
 * @param actionsDisabled - why every write is refused right now (see
 *   `useVersionActions`)
 * @param children - the live document's body, hidden while a version is being
 *   read and rendered normally otherwise
 */
export function ViewedVersionBody({
  fields,
  values,
  actionsDisabled,
  children,
}: {
  fields: FieldConfig[];
  values?: Record<string, unknown>;
  actionsDisabled: boolean;
  children?: ReactNode;
}): JSX.Element {
  const { viewing } = useDocumentHistory();
  return (
    <>
      {/* The live field tree keeps ONE stable parent in both branches, and
          only the wrapper's hidden state toggles: moving the subtree in and
          out of a wrapper would change its React ancestry, which unmounts
          and remounts it — destroying exactly the rich field state (an
          editor's undo history, its selection) that hiding exists to
          preserve. Hidden removes the tree from the accessibility tree and
          from every pointer, so the read-only claim holds. */}
      <div
        aria-hidden={viewing ? true : undefined}
        className={cn(viewing && "hidden")}
      >
        {children}
      </div>
      {viewing ? (
        <ViewedVersionFrame
          key={viewing.versionNo}
          viewing={viewing}
          fields={fields}
          values={values ?? {}}
          actionsDisabled={actionsDisabled}
        />
      ) : null}
    </>
  );
}
