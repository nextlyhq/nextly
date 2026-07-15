// Lightweight confirmation dialog shown when the user saves a SAFE
// schema change in the Schema Builder. Safe changes always require
// explicit confirmation so there are no surprises, but they get a
// shorter dialog than the destructive SchemaChangeDialog (no row
// counts, no interactive fields, no SQL preview).
"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
} from "@nextlyhq/ui";
import { CheckCircle2 } from "lucide-react";

import type { SchemaPreviewChange } from "@admin/services/schemaApi";

interface SafeChangeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string;
  changes: SchemaPreviewChange;
  onConfirm: () => void;
  isApplying: boolean;
}

export function SafeChangeConfirmDialog({
  open,
  onOpenChange,
  collectionName,
  changes,
  onConfirm,
  isApplying,
}: SafeChangeConfirmDialogProps) {
  const hasChanges =
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.changed.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-success-600 dark:text-success-400 mb-1">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Safe change
            </span>
          </div>
          <AlertDialogTitle>
            Apply changes to <span className="font-mono">{collectionName}</span>
            ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            These changes do not affect existing data. Your dev server will
            restart so the new schema is picked up.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasChanges && (
          <div className="flex flex-col gap-2 py-2">
            {changes.added.map(f => (
              <div key={`add-${f.name}`} className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-xs bg-success-50 border-success-200 text-success-700 dark:bg-success-950/40 dark:border-success-900/50 dark:text-success-300"
                >
                  + {f.name}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {f.type}
                  {f.required ? ", required" : ", optional"}
                </span>
              </div>
            ))}
            {changes.removed.map(f => (
              <div key={`rm-${f.name}`} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  - {f.name}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  no rows affected
                </span>
              </div>
            ))}
            {changes.changed.map(f => (
              <div key={`ch-${f.name}`} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  ~ {f.name}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {f.from} to {f.to}
                </span>
              </div>
            ))}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isApplying}>
            {isApplying ? "Applying..." : "Apply and restart"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
