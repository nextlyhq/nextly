"use client";

/**
 * The confirmation a builder page shows between previewing a schema change and
 * applying it.
 *
 * One preview picks one of two dialogs: an additive change with no rename
 * candidates gets the short confirmation, and everything else — destructive,
 * interactive, or carrying renames — gets the full one, where the user resolves
 * each field. That split is stated here and nowhere else; the pages used to
 * write it a second time to decide which flag to raise.
 */
import type { JSX } from "react";

import {
  previewWithDecidedRenames,
  renameAnswers,
  type DraftRename,
} from "@admin/lib/builder/rename-answers";
import type { SettingChange } from "@admin/lib/builder/settings-changes";
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";

import type { BuilderKind } from "./builder-config";
import { CreateEntityConfirmDialog } from "./CreateEntityConfirmDialog";
import type { FieldGroupCreate } from "./FieldGroupCreatesList";
import { SafeChangeConfirmDialog } from "./SafeChangeConfirmDialog";
import { SchemaChangeDialog } from "./SchemaChangeDialog";
import { SettingsChangeConfirmDialog } from "./SettingsChangeConfirmDialog";
import type { SchemaChangeConfirmation } from "./types";

type Props = {
  /** The pending change and the state describing it. */
  confirmation: SchemaChangeConfirmation;
  /** The kind being changed; both dialogs name it in their copy. */
  kind: BuilderKind;
  /** Slug of the entity being changed; both dialogs show it in their copy. */
  entityName: string;
  /**
   * Apply the previewed change. The safe path resolves nothing, so it confirms
   * with an empty resolution set.
   */
  onConfirm: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: SchemaRenameResolution[]
  ) => void;
  /**
   * The entity is not on the server yet, so this save is its create. Its
   * review says what will be created, rather than judging a change.
   */
  creating?: boolean;
  /** The saved fields the draft renamed, which the save answers as renames itself. */
  draftRenames?: readonly DraftRename[];
  /** The entity's settings the save changes, each reviewed with it. */
  settingChanges?: readonly SettingChange[];
  /**
   * The field groups not saved yet that the save creates before the entity:
   * every review lists them first.
   */
  fieldGroupCreates?: readonly FieldGroupCreate[];
};

/**
 * Whether a preview can be applied without asking the user to resolve
 * anything: additive, with no rename the server wants a decision on, no
 * field leaving or joining translation, and no field removed. The short
 * confirmation says the change does not affect existing data, which is untrue
 * when a field's other languages move to the archive, when a field's values
 * become the default language's, and when a field is removed:
 * its column goes, and the preview's count of the values in it reads 0 when
 * counting fails. Those changes get the full dialog, where a removal is red.
 */
export function isSafeChange(preview: SchemaPreviewResponse): boolean {
  return (
    preview.classification === "safe" &&
    preview.changes.removed.length === 0 &&
    !(preview.renamed && preview.renamed.length > 0) &&
    !(preview.leavingTranslation && preview.leavingTranslation.length > 0) &&
    !(preview.joiningTranslation && preview.joiningTranslation.length > 0)
  );
}

export function BuilderSchemaChangeDialogs({
  confirmation,
  kind,
  entityName,
  onConfirm,
  creating = false,
  draftRenames = [],
  settingChanges = [],
  fieldGroupCreates = [],
}: Props): JSX.Element | null {
  const {
    preview: previewed,
    previewId,
    isOpen,
    isApplying,
    setOpen,
  } = confirmation;

  if (!previewed) return null;
  // The Builder's own renames are decided, not asked: shown as renames whose values are kept.
  const { decided, sameColumn } = renameAnswers(
    draftRenames,
    previewed.renamed ?? []
  );
  const preview = previewWithDecidedRenames(previewed, decided, sameColumn);
  // Each rename the save keeps, by its columns, and one that keeps its column by its names.
  const keptRenames = [
    ...decided,
    ...sameColumn.map(r => ({ from: r.previousName, to: r.name })),
  ];

  if (creating) {
    return (
      <CreateEntityConfirmDialog
        key={previewId}
        open={isOpen}
        onOpenChange={setOpen}
        kind={kind}
        entityName={entityName}
        changes={preview.changes}
        fieldGroupCreates={fieldGroupCreates}
        settingChanges={settingChanges}
        onConfirm={() => onConfirm({}, [])}
        isApplying={isApplying}
      />
    );
  }

  // No field changes, only settings or field groups to create: reviewed as
  // such, saved without a migration or a restart.
  if (
    !preview.hasChanges &&
    (settingChanges.length > 0 || fieldGroupCreates.length > 0)
  ) {
    return (
      <SettingsChangeConfirmDialog
        key={previewId}
        open={isOpen}
        onOpenChange={setOpen}
        kind={kind}
        entityName={entityName}
        settingChanges={settingChanges}
        fieldGroupCreates={fieldGroupCreates}
        onConfirm={() => onConfirm({}, [])}
        isApplying={isApplying}
      />
    );
  }

  if (isSafeChange(preview) && keptRenames.length === 0) {
    return (
      <SafeChangeConfirmDialog
        key={previewId}
        open={isOpen}
        onOpenChange={setOpen}
        kind={kind}
        entityName={entityName}
        changes={preview.changes}
        settingChanges={settingChanges}
        fieldGroupCreates={fieldGroupCreates}
        onConfirm={() => onConfirm({}, [])}
        isApplying={isApplying}
      />
    );
  }

  return (
    <SchemaChangeDialog
      key={previewId}
      open={isOpen}
      onOpenChange={setOpen}
      kind={kind}
      entityName={entityName}
      hasDestructiveChanges={preview.hasDestructiveChanges}
      classification={preview.classification}
      changes={preview.changes}
      renamed={preview.renamed}
      decidedRenames={keptRenames}
      warnings={preview.warnings}
      interactiveFields={preview.interactiveFields}
      leavingTranslation={preview.leavingTranslation}
      joiningTranslation={preview.joiningTranslation}
      settingChanges={settingChanges}
      fieldGroupCreates={fieldGroupCreates}
      onConfirm={onConfirm}
      isApplying={isApplying}
    />
  );
}
