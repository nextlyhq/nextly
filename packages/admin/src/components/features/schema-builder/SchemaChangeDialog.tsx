"use client";

// Confirmation dialog for schema changes in the visual schema builder.
// Shows a preview of added/removed/changed fields with row-count impact
// and interactive prompts for fields that need user input.
"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Input,
  Label,
} from "@nextlyhq/ui";
import { AlertTriangle } from "lucide-react";
import type { JSX } from "react";
import { useMemo, useState } from "react";

import { useFieldTypeLabel } from "@admin/lib/builder/field-type-label";
import { reviewDeletesData } from "@admin/lib/builder/review-deletes-data";
import type {
  SchemaPreviewChange,
  SchemaPreviewLeavingTranslation,
  SchemaPreviewRenameCandidate,
  SchemaRenameResolution,
  InteractiveField,
  FieldResolution,
} from "@admin/services/schemaApi";

import { BUILDER_KIND_NOUN, type BuilderKind } from "./builder-config";
import { LeavingTranslationNotice } from "./LeavingTranslationNotice";

interface SchemaChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kind being saved, named in the title and the description. */
  kind: BuilderKind;
  /** Slug of the entity being saved. */
  entityName: string;
  hasDestructiveChanges: boolean;
  classification: "safe" | "destructive" | "interactive";
  changes: SchemaPreviewChange;
  // F4 Option E PR 5: rename candidates from the preview endpoint.
  // Empty array (or undefined) = no candidates, no rename UI rendered.
  renamed?: SchemaPreviewRenameCandidate[];
  warnings: string[];
  interactiveFields: InteractiveField[];
  // Fields that stop being translated: what moves to the archive, or why the change is refused.
  leavingTranslation?: SchemaPreviewLeavingTranslation[];
  onConfirm: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: SchemaRenameResolution[]
  ) => void;
  isApplying: boolean;
}

export function SchemaChangeDialog({
  open,
  onOpenChange,
  kind,
  entityName,
  hasDestructiveChanges,
  classification,
  changes,
  renamed,
  warnings,
  interactiveFields,
  leavingTranslation = [],
  onConfirm,
  isApplying,
}: SchemaChangeDialogProps): JSX.Element {
  // Rows name a field's type by its plain name, never its internal id.
  const typeLabel = useFieldTypeLabel();

  // Track user resolutions for interactive fields
  const [resolutions, setResolutions] = useState<
    Record<string, FieldResolution>
  >({});

  // F4 Option E PR 5: rename selections, keyed by `${table}::${fromColumn}`.
  // Value is the chosen `toColumn` for "rename", or null for "drop and add".
  // Default each drop to the first type-compatible candidate (so the user's
  // common case is one click); falls back to "drop_and_add" otherwise.
  const candidatesByDrop = useMemo(() => {
    const map = new Map<string, SchemaPreviewRenameCandidate[]>();
    for (const c of renamed ?? []) {
      const key = `${c.table}::${c.from}`;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [renamed]);

  const [renameSelections, setRenameSelections] = useState<
    Record<string, string | null>
  >(() => {
    const out: Record<string, string | null> = {};
    for (const [key, group] of candidatesByDrop) {
      // A preserving rename before one that merely fits: pre-selecting a
      // conversion that rewrites every row decides for the author.
      const compatible =
        group.find(c => c.typesCompatible && c.preservesValues) ??
        group.find(c => c.typesCompatible);
      out[key] = compatible ? compatible.to : null;
    }
    return out;
  });

  const hasChanges =
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.changed.length > 0;

  // A field that cannot leave translation in one change is refused by the server, so the dialog
  // does not offer Apply, and any prompt the same field raises (a default for its new shared
  // column, say) is moot: the change that would need the answer will not run.
  // Matched by column: the classifier's prompts name a field by its column (`meta_title`), the
  // notice by its name (`metaTitle`).
  const refusedColumns = new Set(
    leavingTranslation.filter(field => field.refusal).map(field => field.column)
  );
  const refused = refusedColumns.size > 0;
  const promptedFields = interactiveFields.filter(
    f => !refusedColumns.has(f.name)
  );

  // Check if all interactive fields have been resolved with valid values.
  // "provide_default" requires a non-empty value; "mark_nullable" is always valid.
  const allResolved = promptedFields.every(f => {
    const res = resolutions[f.name];
    if (!res?.action) return false;
    if (res.action === "provide_default") return !!res.value?.trim();
    return true;
  });
  const canApply =
    (classification !== "interactive" || allResolved) && !refused;
  // When nothing in the change could be saved, there is no Save to disable: the dialog offers
  // only Close. When something could, Save stays (disabled) with what to fix beside it.
  const nothingSaveable =
    refused &&
    !hasChanges &&
    candidatesByDrop.size === 0 &&
    promptedFields.length === 0 &&
    leavingTranslation.every(field => field.refusal);

  const updateResolution = (fieldName: string, resolution: FieldResolution) => {
    setResolutions(prev => ({ ...prev, [fieldName]: resolution }));
  };

  const updateRename = (dropKey: string, target: string | null) => {
    setRenameSelections(prev => ({ ...prev, [dropKey]: target }));
  };

  // Attach an explicit confirm_drop for every removed field the user just
  // reviewed above. Removing a field drops its column and destroys the data
  // in it, and the server's schema pipeline now refuses any destructive drop
  // it was not told to make. Renames (a drop paired with an add) are carried
  // by the rename resolutions and filtered server-side, so a confirm_drop for
  // one of those is a harmless no-op. Interactive resolutions (NOT NULL /
  // default) win on a name collision.
  const buildResolutions = (): Record<string, FieldResolution> => {
    const confirmed: Record<string, FieldResolution> = {};
    for (const field of changes.removed) {
      confirmed[field.name] = { action: "confirm_drop" };
    }
    return { ...confirmed, ...resolutions };
  };

  // Translate per-drop selections into one resolution per candidate (the
  // shape the apply endpoint expects). For each candidate, "rename" only
  // when its target matches the drop's selection; otherwise "drop_and_add".
  const buildRenameResolutions = (): SchemaRenameResolution[] => {
    const out: SchemaRenameResolution[] = [];
    for (const c of renamed ?? []) {
      const dropKey = `${c.table}::${c.from}`;
      const target = renameSelections[dropKey];
      out.push({
        tableName: c.table,
        fromColumn: c.from,
        toColumn: c.to,
        choice: target === c.to ? "rename" : "drop_and_add",
      });
    }
    return out;
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <SchemaChangeDialogHeader
          kind={kind}
          entityName={entityName}
          title={dialogTitle(
            kind,
            refused,
            classification,
            hasDestructiveChanges
          )}
          refused={refused}
        />

        {/* Changes list */}
        {hasChanges && (
          <div className="max-h-64 overflow-y-auto rounded-md  border border-border bg-primary/5 p-3">
            {changes.added.map(field => (
              <div
                key={`add-${field.name}`}
                className="flex items-center gap-2.5 py-1.5 text-sm [&+&]:border-t border-border [&+&]:border-border"
              >
                <Badge variant="success">added</Badge>
                <span>
                  <strong>{field.name}</strong>{" "}
                  <span className="text-muted-foreground">
                    ({typeLabel(field.type)})
                  </span>
                </span>
              </div>
            ))}

            {changes.removed.map(field => (
              <div
                key={`rm-${field.name}`}
                className="flex flex-col gap-1 py-1.5 text-sm [&+&]:border-t border-border [&+&]:border-border"
              >
                <div className="flex items-center gap-2.5">
                  <Badge variant="destructive">removed</Badge>
                  <span>
                    <strong>{field.name}</strong>{" "}
                    <span className="text-muted-foreground">
                      ({typeLabel(field.type)})
                    </span>
                  </span>
                </div>
                {field.rowCount > 0 && (
                  <span className="ml-16 text-xs text-destructive">
                    {field.rowCount.toLocaleString()} rows have non-null data
                  </span>
                )}
              </div>
            ))}

            {changes.changed.map(field => (
              <div
                key={`ch-${field.name}`}
                className="flex flex-col gap-1 py-1.5 text-sm [&+&]:border-t border-border [&+&]:border-border"
              >
                <div className="flex items-center gap-2.5">
                  <Badge variant="warning">changed</Badge>
                  <span>
                    <strong>{field.name}</strong>{" "}
                    <span className="text-muted-foreground">
                      {typeLabel(field.from)} &rarr; {typeLabel(field.to)}
                    </span>
                  </span>
                </div>
                {field.rowCount > 0 && (
                  <span className="ml-16 text-xs text-warning-600">
                    {field.rowCount.toLocaleString()} rows may be affected
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <LeavingTranslationNotice fields={leavingTranslation} />

        {/* Rename candidates - one section per dropped column with a list
            of "rename to X" radios + a "drop and add new" option.
            We deliberately don't enforce one-target-per-drop in the
            dialog: server's applyResolutionsToOperations is
            duplicate-safe (consumes a (drop, add) pair only once), and
            independent radios match user expectations better than a
            shrinking-pool UX. If two drops both pick "X" as their target,
            only the first rename runs; the second drop falls through as
            drop_and_add. F8 may revisit this once the Classifier ships. */}
        {candidatesByDrop.size > 0 && (
          <div className="space-y-3 rounded-md  border border-border bg-primary/5 p-3">
            <Label className="text-sm font-medium">
              Possible field renames
            </Label>
            {Array.from(candidatesByDrop.entries()).map(([dropKey, group]) => {
              const first = group[0];
              if (!first) return null;
              return (
                <div key={dropKey} className="space-y-1.5">
                  {/* A removed field is known here only by its column, so it is
                      shown as its name in the database and API, labelled as
                      that. The table it lives in is left out: it is an
                      internal name and tells an author nothing. */}
                  <div className="text-sm">
                    A field was removed. Its name in the database and API:{" "}
                    <code
                      className="font-mono text-xs"
                      data-builder-copy="database-name"
                    >
                      {first.from}
                    </code>
                  </div>
                  <div className="flex flex-col gap-1.5 pl-2">
                    {group.map(c => (
                      <label
                        key={c.to}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="radio"
                          name={`rename-${dropKey}`}
                          checked={renameSelections[dropKey] === c.to}
                          onChange={() => updateRename(dropKey, c.to)}
                        />
                        {/* The outcome stands in for the two column types,
                            which are the database's names for them. */}
                        <span>
                          Rename to{" "}
                          <code className="font-mono text-xs">{c.to}</code>{" "}
                          <span className="text-muted-foreground">
                            (
                            {!c.typesCompatible
                              ? "incompatible types, not recommended"
                              : c.preservesValues
                                ? "data preserved"
                                : "rows kept, values change"}
                            )
                          </span>
                        </span>
                      </label>
                    ))}
                    {/* The reason sits under the option rather than inside its
                        parenthetical: it is the sentence an author needs to
                        decide, and a conversion that rewrites every row should
                        not read as a footnote on a radio label. */}
                    {group
                      .filter(c => c.typesCompatible && !c.preservesValues)
                      .map(c => (
                        <p
                          key={`${c.to}-why`}
                          className="pl-6 text-xs text-muted-foreground"
                        >
                          <code className="font-mono text-foreground">
                            {c.to}:
                          </code>{" "}
                          {c.valueChangeReason}
                        </p>
                      ))}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`rename-${dropKey}`}
                        checked={renameSelections[dropKey] === null}
                        onChange={() => updateRename(dropKey, null)}
                      />
                      <span>Remove it and add a new field (data lost)</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Interactive fields -- need user input */}
        {promptedFields.length > 0 && (
          <div className="space-y-3 rounded-md  border border-border border-warning-200 bg-warning-50 p-3 dark:border-warning-800 dark:bg-warning-950">
            {promptedFields.map(field => (
              <div key={field.name} className="space-y-2">
                {/* The prompt says what needs an answer in plain words; the
                    field is known here only by its column, so that is shown
                    as its name in the database and API, labelled as that. */}
                <Label className="text-sm font-medium">
                  {field.reason === "new_required_no_default"
                    ? `A new required field has no value in ${field.tableRowCount.toLocaleString()} existing entries`
                    : `A field made required is empty in ${field.nullCount?.toLocaleString()} entries`}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Its name in the database and API:{" "}
                  <code className="font-mono" data-builder-copy="database-name">
                    {field.name}
                  </code>
                </p>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`resolve-${field.name}`}
                      checked={
                        resolutions[field.name]?.action === "provide_default"
                      }
                      onChange={() =>
                        updateResolution(field.name, {
                          action: "provide_default",
                          value: resolutions[field.name]?.value ?? "",
                        })
                      }
                    />
                    Provide a default value
                  </label>
                  {resolutions[field.name]?.action === "provide_default" && (
                    <Input
                      className="ml-6 h-8"
                      placeholder="Enter default value..."
                      value={resolutions[field.name]?.value ?? ""}
                      onChange={e =>
                        updateResolution(field.name, {
                          action: "provide_default",
                          value: e.target.value,
                        })
                      }
                    />
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`resolve-${field.name}`}
                      checked={
                        resolutions[field.name]?.action === "mark_nullable"
                      }
                      onChange={() =>
                        updateResolution(field.name, {
                          action: "mark_nullable",
                        })
                      }
                    />
                    Mark as optional instead
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Destructive warning */}
        {hasDestructiveChanges && warnings.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Data loss warning</AlertTitle>
            <AlertDescription>
              {warnings.map((w, i) => (
                <span key={i} className="block">
                  {w}
                </span>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <SchemaChangeDialogFooter
          nothingSaveable={nothingSaveable}
          refusedCount={refusedColumns.size}
          // Red only when saving deletes stored values, read from the
          // preview's rows; the overall flag also covers changes that only
          // need an answer.
          emphasisDestructive={reviewDeletesData(changes) && !refused}
          isApplying={isApplying}
          canApply={canApply}
          onClose={() => onOpenChange(false)}
          onApply={() =>
            onConfirm(buildResolutions(), buildRenameResolutions())
          }
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The review's title, in sentence case like every Builder title. The plain
 * save names the kind it saves, so a Single's review does not read "Save
 * collection".
 */
function dialogTitle(
  kind: BuilderKind,
  refused: boolean,
  classification: SchemaChangeDialogProps["classification"],
  hasDestructiveChanges: boolean
): string {
  if (refused) return "Schema change needs another step";
  if (classification === "interactive") return "Schema changes need input";
  return hasDestructiveChanges
    ? "Schema changes detected"
    : `Save ${BUILDER_KIND_NOUN[kind]}`;
}

function SchemaChangeDialogHeader({
  kind,
  entityName,
  title,
  refused,
}: {
  kind: BuilderKind;
  entityName: string;
  title: string;
  refused: boolean;
}) {
  const noun = BUILDER_KIND_NOUN[kind];
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      {/* A refused change applies nothing, so the description must not promise
          it will. Both sentences name the kind being saved. */}
      <AlertDialogDescription>
        {refused
          ? `This change cannot be saved to the ${noun} `
          : `The following changes will be applied to the ${noun} `}
        <strong className="text-foreground">{entityName}</strong>
        {refused ? " in one step." : "."}
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}

/**
 * When nothing in the change could be saved there is no Save to disable, so the footer offers
 * only Close. When something could, Save stays, disabled, with what to fix beside it.
 */
function SchemaChangeDialogFooter({
  nothingSaveable,
  refusedCount,
  emphasisDestructive,
  isApplying,
  canApply,
  onClose,
  onApply,
}: {
  nothingSaveable: boolean;
  refusedCount: number;
  emphasisDestructive: boolean;
  isApplying: boolean;
  canApply: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  if (nothingSaveable) {
    return (
      <AlertDialogFooter>
        <AlertDialogAction onClick={onClose}>Close</AlertDialogAction>
      </AlertDialogFooter>
    );
  }
  return (
    <AlertDialogFooter>
      {refusedCount > 0 && (
        <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
          {refusedCount === 1
            ? "Fix the field above to save."
            : "Fix the fields above to save."}
        </p>
      )}
      <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={e => {
          // Prevent auto-close so we show the overlay during apply
          e.preventDefault();
          onApply();
        }}
        disabled={isApplying || !canApply}
        // The variant carries the fill and its contrast notes (button.tsx).
        variant={emphasisDestructive ? "destructive" : "primary"}
      >
        {/* Sentence case, as every Builder button is. */}
        {isApplying
          ? "Applying..."
          : emphasisDestructive
            ? "Apply changes"
            : "Save changes"}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}
