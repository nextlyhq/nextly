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
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";

import { SafeChangeConfirmDialog } from "./SafeChangeConfirmDialog";
import { SchemaChangeDialog } from "./SchemaChangeDialog";
import type { SchemaChangeConfirmation } from "./types";

type Props = {
  /** The pending change and the state describing it. */
  confirmation: SchemaChangeConfirmation;
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
};

/**
 * Whether a preview can be applied without asking the user to resolve
 * anything: additive, and with no rename the server wants a decision on.
 */
export function isSafeChange(preview: SchemaPreviewResponse): boolean {
  return (
    preview.classification === "safe" &&
    !(preview.renamed && preview.renamed.length > 0)
  );
}

export function BuilderSchemaChangeDialogs({
  confirmation,
  entityName,
  onConfirm,
}: Props) {
  const { preview, isOpen, isApplying, setOpen } = confirmation;

  if (!preview) return null;

  if (isSafeChange(preview)) {
    return (
      <SafeChangeConfirmDialog
        open={isOpen}
        onOpenChange={setOpen}
        collectionName={entityName}
        changes={preview.changes}
        onConfirm={() => onConfirm({}, [])}
        isApplying={isApplying}
      />
    );
  }

  return (
    <SchemaChangeDialog
      open={isOpen}
      onOpenChange={setOpen}
      collectionName={entityName}
      hasDestructiveChanges={preview.hasDestructiveChanges}
      classification={preview.classification}
      changes={preview.changes}
      renamed={preview.renamed}
      warnings={preview.warnings}
      interactiveFields={preview.interactiveFields}
      onConfirm={onConfirm}
      isApplying={isApplying}
    />
  );
}
