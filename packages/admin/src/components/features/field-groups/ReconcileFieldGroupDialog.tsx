"use client";

/**
 * Repair a field group's stored definition, showing the plan before it runs.
 *
 * ## Why a plan comes first
 *
 * The repair rewrites the definition to describe the tables, and parts of that are not undone by
 * running it again: a field whose column vanished loses its authored label, validation and
 * options, and a column nobody declared is adopted under a logical type GUESSED from a physical
 * one — so an `email` column comes back as `text`. An operator asked to approve that has to be
 * able to read it first.
 *
 * ## Why one dialog rather than a confirm and a result
 *
 * The confirm step has content: it IS the plan. Splitting it would show that plan on one surface,
 * close it, and reopen a second showing overlapping information. Phases keep the operator's eye in
 * one place, and the outcome replaces the plan where the plan was.
 *
 * ## Why three lists rather than one
 *
 * They ask different things. A repair is informational; a removal states a loss that has already
 * happened in the database; an adoption is the only one carrying an action, because the guessed
 * type usually needs correcting afterwards. Identities rather than counts throughout — the
 * operator's question is whether THEIR field is in the list, which a number cannot answer.
 *
 * @module components/features/field-groups/ReconcileFieldGroupDialog
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nextlyhq/ui";
import type { ReconcileFieldGroupPreview } from "nextly/field-group-reconcile";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
} from "@admin/components/icons";
import {
  useFieldGroupReconcile,
  useFieldGroupReconcilePreview,
} from "@admin/hooks/queries/useFieldGroupReconcile";

export interface ReconcileFieldGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldGroupSlug: string;
  /** Shown in the heading, because a slug is not what the operator calls this thing. */
  fieldGroupLabel?: string;
}

/** A titled block of identities. Renders nothing at all when it has none to show. */
function Section({
  title,
  tone = "neutral",
  note,
  items,
}: {
  title: string;
  tone?: "neutral" | "warning";
  note?: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-1">
      <h4
        className={
          tone === "warning"
            ? "text-sm font-medium text-destructive"
            : "text-sm font-medium text-foreground"
        }
      >
        {title}
      </h4>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      <ul className="space-y-1">
        {items.map(item => (
          <li
            key={item}
            className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The plan, as three lists of identities. */
function PlanBody({ plan }: { plan: ReconcileFieldGroupPreview }) {
  return (
    <div className="space-y-4">
      <Section
        title="Corrected"
        note="Kept as they are, with one physical attribute brought back in line."
        items={plan.repaired.map(
          r =>
            `${r.fieldName}.${r.attribute}: ${String(r.from)} → ${String(r.to)}`
        )}
      />
      <Section
        title="Removed"
        note="These columns are already gone from the database, so their data went with them. Removing them from the definition is what makes the record honest again."
        items={plan.removed.map(r => `${r.fieldName} (column ${r.columnName})`)}
      />
      <Section
        title="Adopted — needs your attention"
        tone="warning"
        note="A column nothing described. Its type is a guess made from the physical column, so check each one in the field editor afterwards and correct it if the guess is wrong."
        items={plan.adopted.map(
          a => `${a.fieldName} → ${a.guessedType} (from ${a.liveType})`
        )}
      />
    </div>
  );
}

export function ReconcileFieldGroupDialog({
  open,
  onOpenChange,
  fieldGroupSlug,
  fieldGroupLabel,
}: ReconcileFieldGroupDialogProps) {
  const preview = useFieldGroupReconcilePreview(fieldGroupSlug, open);
  const repair = useFieldGroupReconcile();

  const plan = preview.data;
  const outcome = repair.data;
  const blocked = Boolean(plan && plan.blockers.length > 0);
  const name = fieldGroupLabel ?? fieldGroupSlug;

  // Only an approvable plan gets a confirm button. A plan that would write nothing, one the server
  // refuses, and one still loading are all states where confirming means nothing.
  const canApply = Boolean(
    plan && !blocked && plan.wouldWrite && !outcome && !repair.isPending
  );

  const handleConfirm = () => {
    if (!plan) return;
    repair.mutate({
      fieldGroupSlug,
      // The version the plan was read against. The server refuses if the row has moved since, so
      // approving a plan can never apply a different one.
      expectedSchemaVersion: plan.schemaVersion,
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) repair.reset();
    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {outcome ? `Repaired “${name}”` : `Repair “${name}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm text-muted-foreground">
              {preview.isPending ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking what would change…
                </p>
              ) : null}

              {preview.isError ? (
                <p className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{preview.error.message}</span>
                </p>
              ) : null}

              {/* The server saw drift it must not decide. Each one is named because the operator's
                  next step differs per kind, and nothing was changed. */}
              {plan && blocked ? (
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This cannot be repaired automatically. Nothing was
                      changed.
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {plan.blockers.map(b => (
                      <li
                        key={`${b.kind}:${b.columnName}`}
                        className="rounded-md bg-muted px-2 py-1 text-xs text-foreground"
                      >
                        <span className="font-mono">{b.columnName}</span> —{" "}
                        {b.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Healthy and unmarked: applying would write nothing at all. */}
              {plan && !blocked && !plan.wouldWrite ? (
                <p className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    The stored definition already describes the tables. There is
                    nothing to repair.
                  </span>
                </p>
              ) : null}

              {/* The definition matches but a failure mark still stands, so applying DOES write —
                  saying so is what keeps an empty change list from contradicting a live button. */}
              {plan && !blocked && plan.wouldWrite && plan.unchanged ? (
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    The fields already match the tables. Applying clears the
                    stale “{plan.staleStatus}” status that is refusing schema
                    edits.
                  </span>
                </p>
              ) : null}

              {plan && !blocked && !outcome ? <PlanBody plan={plan} /> : null}

              {repair.isError ? (
                <p className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{repair.error.message}</span>
                </p>
              ) : null}

              {outcome ? (
                <div className="space-y-4">
                  <p className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      The definition now describes the tables, and schema edits
                      are allowed again.
                    </span>
                  </p>
                  {/* Reported rather than assumed: the repair is durable in the database whether
                      or not this process picked it up, and only a restart fixes the second. */}
                  {!outcome.runtimeRefreshed ? (
                    <p className="flex items-start gap-2 text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        The repair is saved, but this running server is still
                        holding the old shape. Restart it before editing entries
                        in this field group.
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {outcome || blocked || (plan && !plan.wouldWrite) ? (
            <AlertDialogAction onClick={() => handleOpenChange(false)}>
              Done
            </AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel disabled={repair.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={event => {
                  // The dialog stays open so the outcome lands where the plan was.
                  event.preventDefault();
                  handleConfirm();
                }}
                disabled={!canApply}
              >
                {repair.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Repairing…
                  </>
                ) : (
                  "Repair definition"
                )}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
