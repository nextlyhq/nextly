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

import { useState } from "react";

import {
  Alert,
  AlertDescription,
  Button,
  Skeleton,
} from "@admin/components/ui";
import { useVersionDiff } from "@admin/hooks/queries/useVersions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { FieldDiff, VersionScope } from "@admin/services/versionApi";

import { ChangeNav } from "../ChangeNav";
import { UnchangedFieldsToggle } from "../UnchangedFieldsToggle";
import { useChangeNavigation } from "../useChangeNavigation";
import {
  changesCountText,
  isFieldChange,
  versionChangesOf,
} from "../version-changes";
import { changeAnchorId } from "../VersionChangesForm";

import {
  ChangesLayoutProvider,
  ChangesLayoutToggle,
  useChangesLayoutPreference,
} from "./changes-layout";
import { childKey, FieldDiffNode, SystemFieldsProvider } from "./FieldDiffNode";

export interface VersionDiffViewProps {
  scope: VersionScope;
  /** Older version being compared. */
  from: number;
  /** Newer version being compared. */
  to: number;
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

/** A framework column kept on every document, rather than an author's field. */
function isSystemField(node: FieldDiff): boolean {
  return node.kind === "unknown" && node.reason === "system";
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
    changed: authored.filter(isFieldChange),
    hidden: authored.filter(node => node.kind === "hidden"),
    unchanged: authored.filter(
      node => node.kind !== "hidden" && !isFieldChange(node)
    ),
    system,
  };
}

/** A top-level field the moves can land on: in view, and focused. */
function ChangeAnchor({
  node,
  children,
}: {
  node: FieldDiff;
  children: React.ReactNode;
}) {
  return (
    <div
      id={changeAnchorId(node.name)}
      tabIndex={-1}
      className="scroll-mt-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </div>
  );
}

export function VersionDiffView({ scope, from, to }: VersionDiffViewProps) {
  const [layout, setLayout] = useChangesLayoutPreference();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  // Every field, so the count and the fold are of the whole document: the
  // unchanged ones are folded here rather than left out by the server.
  const diff = useVersionDiff({ scope, from, to, modifiedOnly: false });
  const arranged = arrangeFields(diff.data?.fields ?? []);
  const changes = diff.data ? versionChangesOf(diff.data) : null;
  const order = arranged.changed.map(node => node.name);
  const nav = useChangeNavigation(order);

  return (
    // The container the field rows query. Their columns are a function of the
    // width available HERE, not of the viewport: the same view sits in surfaces
    // of different widths, and only its own box knows whether two columns fit.
    <ChangesLayoutProvider value={layout}>
      <div className="@container/diff flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          {/* What is on screen, in words: the pair while the column headings
              are not there to say it, then how much of it changed. */}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className={layout === "split" ? "@2xl/diff:hidden" : ""}>
              Comparing version{" "}
              <span className="font-medium text-foreground">{from}</span> &rarr;{" "}
              <span className="font-medium text-foreground">{to}</span>.{" "}
            </span>
            {changes
              ? changesCountText({
                  changed: arranged.changed.length,
                  total: changes.total - arranged.system.length,
                  incomplete: changes.incomplete,
                })
              : null}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {arranged.changed.length > 0 ? (
              <ChangeNav
                changed={arranged.changed.length}
                position={nav.position}
                onMove={nav.move}
              />
            ) : null}
            <ChangesLayoutToggle layout={layout} onChange={setLayout} />
          </div>
        </div>

        {/* Column headings for the two sides, side by side only, on the same
            grid and padding as each row's value pair so they sit over the
            columns they name. Outside the scrolling body rather than sticky
            within it, so a field far down a long document is still readable as
            belonging to one version or the other. */}
        {layout === "split" ? (
          <div className="hidden grid-cols-2 gap-4 border-b border-border px-4 py-2 @2xl/diff:grid">
            <p className="pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Version {from}
            </p>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Version {to}
            </p>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {diff.isLoading ? (
            <DiffSkeleton />
          ) : diff.isError ? (
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
          ) : diff.data ? (
            <SystemFieldsProvider value={showSystem}>
              <div className="flex flex-col px-4 pb-4">
                {arranged.changed.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    {/* Withheld fields may differ, so "identical" would claim
                        too much. */}
                    {diff.data.incomplete
                      ? "No changes in the fields you can read."
                      : "These two versions are identical."}
                  </p>
                ) : null}
                {arranged.changed.map(node => (
                  <ChangeAnchor key={childKey(node)} node={node}>
                    <FieldDiffNode node={node} />
                  </ChangeAnchor>
                ))}
                {arranged.hidden.map(node => (
                  <FieldDiffNode key={childKey(node)} node={node} />
                ))}
                {showUnchanged
                  ? arranged.unchanged.map(node => (
                      <FieldDiffNode key={childKey(node)} node={node} />
                    ))
                  : null}
                {showSystem
                  ? arranged.system.map(node => (
                      <FieldDiffNode key={childKey(node)} node={node} />
                    ))
                  : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <UnchangedFieldsToggle
                    count={arranged.unchanged.length}
                    shown={showUnchanged}
                    onToggle={() => setShowUnchanged(shown => !shown)}
                  />
                  {arranged.system.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={showSystem}
                      onClick={() => setShowSystem(shown => !shown)}
                    >
                      {showSystem ? "Hide system fields" : "Show system fields"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </SystemFieldsProvider>
          ) : null}
        </div>
      </div>
    </ChangesLayoutProvider>
  );
}
