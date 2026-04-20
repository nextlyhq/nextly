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
import { useState } from "react";

import type {
  SchemaPreviewChange,
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
  warnings: string[];
  interactiveFields: InteractiveField[];
  onConfirm: (resolutions: Record<string, FieldResolution>) => void;
  isApplying: boolean;
}

export function SchemaChangeDialog({
  open,
  onOpenChange,
  collectionName,
  hasDestructiveChanges,
  classification,
  changes,
  warnings,
  interactiveFields,
  onConfirm,
  isApplying,
}: SchemaChangeDialogProps) {
  // Track user resolutions for interactive fields
  const [resolutions, setResolutions] = useState<
    Record<string, FieldResolution>
  >({});

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
              onConfirm(resolutions);
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
