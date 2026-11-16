"use client";

/**
 * The review of a save that changes only the entity's settings: each setting
 * it changes, from what to what. No field changes, so nothing is migrated and
 * the dev server does not restart; Save writes the settings.
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
import type { JSX } from "react";

import type { SettingChange } from "@admin/lib/builder/settings-changes";

import { BUILDER_KIND_NOUN, type BuilderKind } from "./builder-config";
import { SettingChangesList } from "./SettingChangesList";

interface SettingsChangeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kind being saved, named in the title. */
  kind: BuilderKind;
  /** The entity's address. */
  entityName: string;
  settingChanges: readonly SettingChange[];
  onConfirm: () => void;
  isApplying: boolean;
}

export function SettingsChangeConfirmDialog({
  open,
  onOpenChange,
  kind,
  entityName,
  settingChanges,
  onConfirm,
  isApplying,
}: SettingsChangeConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Save the settings of the {BUILDER_KIND_NOUN[kind]}{" "}
            <span className="font-mono">{entityName}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Only these settings change. No field or stored value does.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <SettingChangesList changes={settingChanges} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isApplying}>
            {isApplying ? "Saving..." : "Save"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
