"use client";

/**
 * The review of saving an entity that is not on the server yet: its create.
 *
 * Built in the browser from the fields it will be saved with
 * (`lib/builder/create-preview`), since the server's preview reads an entity it
 * already holds. So it says only what will be created, and makes no claim that
 * the change is safe: the create itself refuses what it refuses.
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
  Badge,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { useFieldTypeLabel } from "@admin/lib/builder/field-type-label";
import type { SettingChange } from "@admin/lib/builder/settings-changes";
import type { SchemaPreviewChange } from "@admin/services/schemaApi";

import { BUILDER_KIND_NOUN, type BuilderKind } from "./builder-config";
import { SettingChangesList } from "./SettingChangesList";

interface CreateEntityConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kind being created, named in the title. */
  kind: BuilderKind;
  /** The address it will be created under. */
  entityName: string;
  /** Every field is in `added`; a create removes and changes nothing. */
  changes: SchemaPreviewChange;
  /** Settings changed since the dialog set them, which the create saves too. */
  settingChanges?: readonly SettingChange[];
  onConfirm: () => void;
  isApplying: boolean;
}

export function CreateEntityConfirmDialog({
  open,
  onOpenChange,
  kind,
  entityName,
  changes,
  settingChanges = [],
  onConfirm,
  isApplying,
}: CreateEntityConfirmDialogProps): JSX.Element {
  const typeLabel = useFieldTypeLabel();
  const noun = BUILDER_KIND_NOUN[kind];
  const hasFields = changes.added.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Create the {noun} <span className="font-mono">{entityName}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The {noun} <span className="font-mono">{entityName}</span> will be
            created
            {hasFields ? " with these fields." : ", with no fields yet."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasFields && (
          <div className="flex flex-col gap-2 py-2">
            {changes.added.map(f => (
              <div key={`add-${f.name}`} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  + {f.name}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {typeLabel(f.type)}
                  {f.required ? ", required" : ", optional"}
                </span>
              </div>
            ))}
          </div>
        )}

        <SettingChangesList changes={settingChanges} />

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isApplying}>
            {isApplying ? "Creating..." : "Create"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
