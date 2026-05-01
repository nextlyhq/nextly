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
} from "@revnixhq/ui";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  SchemaPreviewChange,
  SchemaPreviewRenameCandidate,
  SchemaRenameResolution,
  InteractiveField,
  FieldResolution,
} from "@admin/services/schemaApi";

interface SchemaChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string;
  hasDestructiveChanges: boolean;
  classification: "safe" | "destructive" | "interactive";
  changes: SchemaPreviewChange;
  // F4 Option E PR 5: rename candidates from the preview endpoint.
  // Empty array (or undefined) = no candidates, no rename UI rendered.
  renamed?: SchemaPreviewRenameCandidate[];
  warnings: string[];
  interactiveFields: InteractiveField[];
  onConfirm: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: SchemaRenameResolution[]
  ) => void;
  isApplying: boolean;
}

export function SchemaChangeDialog({
  open,
  onOpenChange,
  collectionName,
  hasDestructiveChanges,
  classification,
  changes,
  renamed,
  warnings,
  interactiveFields,
  onConfirm,
  isApplying,
}: SchemaChangeDialogProps) {
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
      const compatible = group.find(c => c.typesCompatible);
      out[key] = compatible ? compatible.to : null;
    }
    return out;
  });

  const hasChanges =
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.changed.length > 0;

  // Check if all interactive fields have been resolved with valid values.
  // "provide_default" requires a non-empty value; "mark_nullable" is always valid.
  const allResolved = interactiveFields.every(f => {
    const res = resolutions[f.name];
    if (!res?.action) return false;
    if (res.action === "provide_default") return !!res.value?.trim();
    return true;
  });
  const canApply = classification !== "interactive" || allResolved;

  const updateResolution = (fieldName: string, resolution: FieldResolution) => {
    setResolutions(prev => ({ ...prev, [fieldName]: resolution }));
  };

  const updateRename = (dropKey: string, target: string | null) => {
    setRenameSelections(prev => ({ ...prev, [dropKey]: target }));
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
        <AlertDialogHeader>
          <AlertDialogTitle>
            {classification === "interactive"
              ? "Schema Changes Need Input"
              : hasDestructiveChanges
                ? "Schema Changes Detected"
                : "Save Collection"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The following changes will be applied to{" "}
            <strong className="text-foreground">{collectionName}</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Changes list */}
        {hasChanges && (
          <div className="max-h-64 overflow-y-auto rounded border border-border bg-muted/50 p-3">
            {changes.added.map(field => (
              <div
                key={`add-${field.name}`}
                className="flex items-center gap-2.5 py-1.5 text-sm [&+&]:border-t [&+&]:border-border"
              >
                <Badge variant="success">added</Badge>
                <span>
                  <strong>{field.name}</strong>{" "}
                  <span className="text-muted-foreground">({field.type})</span>
                </span>
              </div>
            ))}

            {changes.removed.map(field => (
              <div
                key={`rm-${field.name}`}
                className="flex flex-col gap-1 py-1.5 text-sm [&+&]:border-t [&+&]:border-border"
              >
                <div className="flex items-center gap-2.5">
                  <Badge variant="destructive">removed</Badge>
                  <span>
                    <strong>{field.name}</strong>{" "}
                    <span className="text-muted-foreground">
                      ({field.type})
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
                className="flex flex-col gap-1 py-1.5 text-sm [&+&]:border-t [&+&]:border-border"
              >
                <div className="flex items-center gap-2.5">
                  <Badge variant="warning">changed</Badge>
                  <span>
                    <strong>{field.name}</strong>{" "}
                    <span className="text-muted-foreground">
                      {field.from} &rarr; {field.to}
                    </span>
                  </span>
                </div>
                {field.rowCount > 0 && (
                  <span className="ml-16 text-xs text-amber-600">
                    {field.rowCount.toLocaleString()} rows may be affected
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

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
          <div className="space-y-3 rounded border border-border bg-muted/50 p-3">
            <Label className="text-sm font-medium">
              Possible column renames
            </Label>
            {Array.from(candidatesByDrop.entries()).map(([dropKey, group]) => {
              const first = group[0];
              if (!first) return null;
              return (
                <div key={dropKey} className="space-y-1.5">
                  <div className="text-sm">
                    Column <strong>{first.from}</strong>{" "}
                    <span className="text-muted-foreground">
                      in {first.table}
                    </span>{" "}
                    was removed.
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
                        <span>
                          Rename to <strong>{c.to}</strong>{" "}
                          <span className="text-muted-foreground">
                            ({c.fromType} &rarr; {c.toType}
                            {c.typesCompatible
                              ? "; data preserved"
                              : "; incompatible types, not recommended"}
                            )
                          </span>
                        </span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`rename-${dropKey}`}
                        checked={renameSelections[dropKey] === null}
                        onChange={() => updateRename(dropKey, null)}
                      />
                      <span>
                        Drop <strong>{first.from}</strong> and add new column
                        (data lost)
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Interactive fields -- need user input */}
        {interactiveFields.length > 0 && (
          <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            {interactiveFields.map(field => (
              <div key={field.name} className="space-y-2">
                <Label className="text-sm font-medium">
                  {field.reason === "new_required_no_default"
                    ? `Field "${field.name}" is required but table has ${field.tableRowCount.toLocaleString()} rows`
                    : `Field "${field.name}" has ${field.nullCount?.toLocaleString()} NULL values`}
                </Label>
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

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={e => {
              // Prevent auto-close so we show the overlay during apply
              e.preventDefault();
              onConfirm(resolutions, buildRenameResolutions());
            }}
            disabled={isApplying || !canApply}
            className={
              hasDestructiveChanges
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            {isApplying
              ? "Applying..."
              : hasDestructiveChanges
                ? "Apply Changes"
                : "Save Changes"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
