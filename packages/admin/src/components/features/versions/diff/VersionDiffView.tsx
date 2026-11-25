/**
 * Compares two versions of a document.
 *
 * Fetches the server-computed diff for a version pair and renders it as the
 * editor reads a version's changes: how many fields changed ("3 of 9 fields
 * changed"), the changed fields first with Previous and Next change to move
 * through them, and the unchanged ones folded behind "Show N unchanged fields".
 * Owns its own scrolling body and fills the height its host gives it, so a host
 * supplies a box and this decides how the comparison sits in it.
 *
 * Each change is drawn inline by default, as tracked changes; side by side is
 * the reader's remembered choice (`changes-layout`). In columns, the columns
 * are a function of THIS element's width — it declares the container the rows
 * query — so a side by side reads as one wherever there is room for one and
 * folds into a stack where there is not.
 *
 * @module components/features/versions/diff/VersionDiffView
 */

import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  AlertDescription,
  Button,
  Skeleton,
} from "@admin/components/ui";
import { useVersionDiff } from "@admin/hooks/queries/useVersions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { cn } from "@admin/lib/utils";
import type {
  FieldDiff,
  VersionComparisonPart,
  VersionDiff,
  VersionScope,
} from "@admin/services/versionApi";

import { ChangeNav } from "../ChangeNav";
import { UnchangedFieldsToggle } from "../UnchangedFieldsToggle";
import { useChangeNavigation } from "../useChangeNavigation";
import {
  changesCountText,
  isFieldChange,
  isSystemField,
  versionChangesOf,
  type NoChanges,
} from "../version-changes";
import { baselineLabel } from "../version-pairing";
import { changeAnchorId } from "../VersionChangesForm";

import {
  ChangesLayoutProvider,
  ChangesLayoutToggle,
  layoutFor,
  useChangesLayoutPreference,
  type ChangesLayout,
} from "./changes-layout";
import { FieldRowAction, SideLabelsProvider } from "./diff-primitives";
import { fieldPathLabel } from "./field-path";
import { childKey, FieldDiffNode, SystemFieldsProvider } from "./FieldDiffNode";

export interface VersionDiffViewProps {
  scope: VersionScope;
  /** Older version being compared. */
  from: number;
  /** Newer version being compared. */
  to: number;
  /**
   * The view an address names: inline, or side by side. Absent, the reader's
   * own remembered choice decides.
   */
  view?: "inline" | "side";
  /**
   * Hears the reader switch the view, for a page whose address names it;
   * absent, the switch is remembered as the reader's own choice.
   */
  onViewChange?: (layout: ChangesLayout) => void;
  /**
   * Hears this pair's comparison reach the screen, once its fields are drawn,
   * and `null` once it no longer is. Told only from here, where the fields
   * are drawn, so a host that marks what the reader has seen cannot mark a
   * comparison it decided was showing while something else filled the space.
   * The report carries the language the comparison's answer names, which is
   * authoritative where the host's own address names none.
   */
  onShown?: (
    pair: { from: number; to: number; locale: string | null } | null
  ) => void;
  /**
   * The baseline whose answer already holds this pair's comparison, when the
   * host drew it from one: the pair is then not asked for again (see
   * `useVersionDiff`).
   */
  seededBy?: string;
  /** `shared`: the shared fields alone, compared across languages. */
  part?: VersionComparisonPart;
  /**
   * What the older and the newer version are called, in the line that names
   * the pair and over each side of a field split side by side. Absent, each
   * is named by its number.
   */
  fromLabel?: string;
  toLabel?: string;
  /**
   * What the host offers on one field, drawn in that field's heading row
   * ("Restore this field" on the comparison page); `null` for none.
   */
  fieldAction?: (node: FieldDiff) => ReactNode;
}

function DiffSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        Loading comparison
      </span>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * The fields of a comparison, as the reader meets them: those that changed
 * (the server lists a removed field last), then those the reader may not read,
 * which are named so their absence is not taken for no change, then the
 * unchanged and the system ones, each kept back until asked for.
 */
function arrangeFields(fields: readonly FieldDiff[]) {
  const system = fields.filter(isSystemField);
  const authored = fields.filter(node => !isSystemField(node));
  return {
    // Every field an author wrote, in the form's order (the server lists a
    // removed field last), for when the unchanged ones are shown among them.
    authored,
    changed: authored.filter(isFieldChange),
    hidden: authored.filter(node => node.kind === "hidden"),
    unchanged: authored.filter(
      node => node.kind !== "hidden" && !isFieldChange(node)
    ),
    system,
  };
}

const NO_CHANGES_TEXT: Record<NoChanges, string> = {
  system: "Only system fields changed.",
  unseen: "No changes in the fields you can read.",
  identical: "These two versions are identical.",
};

function NoChangesNote({
  note,
  systemToggle,
}: {
  note: NoChanges;
  systemToggle: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <p className="text-sm text-muted-foreground">{NO_CHANGES_TEXT[note]}</p>
      {/* The control that shows them, beside the words that say so. */}
      {note === "system" ? systemToggle : null}
    </div>
  );
}

/** Shows or hides the framework columns every document keeps. */
function SystemFieldsToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={shown}
      onClick={onToggle}
    >
      {shown ? "Hide system fields" : "Show system fields"}
    </Button>
  );
}

/**
 * One top-level field of the comparison, with what the host offers on it in
 * its heading row. A changed one carries a bar on its leading edge, as the
 * editor marks a changed field, and is where the moves land: in view, and
 * focused.
 */
function FieldChange({
  node,
  changed,
  action,
}: {
  node: FieldDiff;
  changed: boolean;
  action: ReactNode;
}) {
  return (
    <div
      data-field-change=""
      {...(changed ? { id: changeAnchorId(node.name), tabIndex: -1 } : {})}
      className={cn(
        "scroll-mt-4 border-b border-border px-4 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        changed && "border-l-4 border-l-foreground"
      )}
    >
      <FieldRowAction action={action}>
        <FieldDiffNode node={node} />
      </FieldRowAction>
    </div>
  );
}

/**
 * The baseline the server resolved `from` with, said in words read from its name ("since-approved"
 * reads "Since approved"), so a baseline another feature registers reads here as core's do, with
 * no list of names in the admin. Nothing for a pair chosen by number, which names no baseline.
 */
function BaselineNote({
  diff,
}: {
  diff: VersionDiff | undefined;
}): JSX.Element | null {
  const baseline = diff?.baseline;
  if (!baseline) return null;
  const name = baselineLabel(baseline.name);
  // A baseline whose version retention removed names the one standing in for it.
  const which =
    baseline.replaces === undefined
      ? `version ${baseline.versionNo}`
      : `version ${baseline.versionNo}, as version ${baseline.replaces} was removed`;
  return (
    <span className="text-muted-foreground">
      Compared from: {name} ({which}).
    </span>
  );
}

export function VersionDiffView({
  scope,
  from,
  to,
  view,
  onViewChange,
  onShown,
  seededBy,
  part,
  fromLabel = `Version ${from}`,
  toLabel = `Version ${to}`,
  fieldAction,
}: VersionDiffViewProps): JSX.Element {
  const [remembered, remember] = useChangesLayoutPreference();
  // The address's view wins over the remembered one, so a shared link opens
  // the comparison as its sender saw it.
  const preference: ChangesLayout =
    view === undefined ? remembered : view === "side" ? "split" : "inline";
  const setLayout = onViewChange ?? remember;
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  // Every field, so the count and the fold are of the whole document: the
  // unchanged ones are folded here rather than left out by the server.
  const diff = useVersionDiff({
    scope,
    from,
    to,
    modifiedOnly: false,
    ...(seededBy !== undefined ? { seededBy } : {}),
    ...(part !== undefined ? { part } : {}),
  });
  const arranged = arrangeFields(diff.data?.fields ?? []);
  const changes = diff.data ? versionChangesOf(diff.data) : null;
  const order = arranged.changed.map(node => node.name);
  // Said only when no authored field changed.
  const note =
    changes && arranged.changed.length === 0 ? changes.whenNone : null;
  const { layout, splittable } = layoutFor(
    preference,
    changes?.byField.values() ?? []
  );
  const nav = useChangeNavigation(order);
  // The change the position is on, named as its field is in the list.
  const currentChange = arranged.changed[nav.position];
  const currentChangeLabel = currentChange
    ? fieldPathLabel(currentChange, 0)
    : undefined;
  // Which of the body's states is drawn, decided once so the body and the
  // report below cannot disagree about it.
  const body = diff.isLoading
    ? "loading"
    : diff.isError
      ? "error"
      : diff.data
        ? "fields"
        : "empty";
  // This pair is on screen only when its own fields are: another pair's
  // answer kept while this one loads draws fields that are not this pair's.
  const drawn = body === "fields" && !diff.isPlaceholderData;
  // Read through a ref, so a host that hands a new callback each render does
  // not report the same showing again.
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  // The drawn comparison's own language, read once it is drawn.
  const drawnLocale = drawn ? (diff.data?.locale ?? null) : null;
  useEffect(() => {
    if (!drawn) return;
    onShownRef.current?.({ from, to, locale: drawnLocale });
    return () => onShownRef.current?.(null);
  }, [drawn, from, to, drawnLocale]);

  // Changed fields, and those the reader may not read (named so their absence
  // is not taken for no change), always; the unchanged ones among them, in
  // the form's order, once asked for.
  const shownFields = showUnchanged
    ? arranged.authored
    : arranged.authored.filter(
        node => isFieldChange(node) || node.kind === "hidden"
      );
  // A field gone from the content type carries only its name.
  const removedListed = arranged.authored.some(node => !("label" in node));

  return (
    // The container the field rows query. Their columns are a function of the
    // width available HERE, not of the viewport: the same view sits in surfaces
    // of different widths, and only its own box knows whether two columns fit.
    <ChangesLayoutProvider value={layout}>
      <SideLabelsProvider value={{ before: fromLabel, after: toLabel }}>
        <div className="@container/diff flex min-h-0 flex-1 flex-col">
          {/* How much changed, the fold, the way through the changes and
              how they are drawn: one row, as the editor's comparison bar. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {changes ? (
                <span className="font-medium text-foreground">
                  {changesCountText({
                    changed: changes.byField.size,
                    total: changes.total,
                    incomplete: changes.incomplete,
                  })}
                </span>
              ) : null}
            </p>
            {body === "fields" ? (
              <UnchangedFieldsToggle
                count={arranged.unchanged.length}
                shown={showUnchanged}
                onToggle={() => setShowUnchanged(shown => !shown)}
              />
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {arranged.changed.length > 0 ? (
                <ChangeNav
                  changed={arranged.changed.length}
                  position={nav.position}
                  onMove={nav.move}
                  currentLabel={currentChangeLabel}
                />
              ) : null}
              <ChangesLayoutToggle
                layout={layout}
                onChange={setLayout}
                splittable={splittable}
              />
            </div>
          </div>
          {/* Which two versions, by name, and the baseline the server
              resolved, so the count above is read against them. */}
          <p className="border-b border-border px-4 pt-1 pb-3 text-xs text-muted-foreground">
            Changes from{" "}
            <span className="font-medium text-foreground">{fromLabel}</span> to{" "}
            <span className="font-medium text-foreground">{toLabel}</span>.{" "}
            <BaselineNote diff={diff.data} />
            {removedListed
              ? " Fields no longer in the content type are listed last."
              : null}
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {body === "loading" ? (
              <DiffSkeleton />
            ) : body === "error" ? (
              <div className="p-4 flex flex-col gap-3">
                <Alert variant="destructive">
                  <AlertDescription>
                    {apiErrorMessage(diff.error) ||
                      "This comparison could not be loaded."}
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void diff.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : body === "fields" ? (
              <SystemFieldsProvider value={showSystem}>
                <div className="flex flex-col gap-3 p-4">
                  {note ? (
                    <NoChangesNote
                      note={note}
                      systemToggle={
                        <SystemFieldsToggle
                          shown={showSystem}
                          onToggle={() => setShowSystem(shown => !shown)}
                        />
                      }
                    />
                  ) : null}
                  {shownFields.length > 0 || showSystem ? (
                    // The fields as one card, as the form draws them.
                    <div className="rounded-lg border border-border bg-card">
                      {shownFields.map(node => (
                        <FieldChange
                          key={childKey(node)}
                          node={node}
                          changed={isFieldChange(node)}
                          action={fieldAction?.(node) ?? null}
                        />
                      ))}
                      {showSystem
                        ? arranged.system.map(node => (
                            <FieldChange
                              key={childKey(node)}
                              node={node}
                              changed={false}
                              action={null}
                            />
                          ))
                        : null}
                    </div>
                  ) : null}
                  {arranged.system.length > 0 && note !== "system" ? (
                    <SystemFieldsToggle
                      shown={showSystem}
                      onToggle={() => setShowSystem(shown => !shown)}
                    />
                  ) : null}
                </div>
              </SystemFieldsProvider>
            ) : null}
          </div>
        </div>
      </SideLabelsProvider>
    </ChangesLayoutProvider>
  );
}
