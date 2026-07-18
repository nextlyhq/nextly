"use client";

/**
 * Add Field Dialog
 *
 * Type selection for new form fields, rendered from the shared field-type
 * catalog via the SDK's FieldTypePicker so the form surface shows the same
 * labels, icons, and hints as every other field picker in the admin.
 *
 * @module admin/components/builder/AddFieldDialog
 */

import { FieldTypePicker } from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { FieldTypeCatalogEntry } from "nextly/field-catalog";
import { useState } from "react";

import type { FormFieldTypeId } from "../../../types";

export interface AddFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The form surface's catalog — built-ins already filtered by the host's
   * excludes plus any plugin field types that opted into the forms surface;
   * `null` while the host configuration is still loading. `type` is the open
   * `FormFieldTypeId` so a plugin entry shares this shape with the built-ins.
   */
  entries: readonly FieldTypeCatalogEntry<FormFieldTypeId>[] | null;
  /** Called with the chosen type; the parent creates and selects the field. */
  onAdd: (type: FormFieldTypeId) => void;
}

export function AddFieldDialog({
  open,
  onOpenChange,
  entries,
  onAdd,
}: AddFieldDialogProps) {
  const [selected, setSelected] = useState<FormFieldTypeId>("text");

  const selectable = entries?.some(entry => entry.type === selected)
    ? selected
    : entries?.[0]?.type;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add field</DialogTitle>
          <DialogDescription>
            Pick the field type. Everything else is edited on the field card.
          </DialogDescription>
        </DialogHeader>

        {entries === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading the available field types…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All field types are disabled by this site&apos;s form-builder
            configuration.
          </p>
        ) : (
          <FieldTypePicker
            entries={entries}
            value={selectable ?? "text"}
            onChange={setSelected}
            columns={3}
            ariaLabel="Field type"
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectable}
            onClick={() => {
              if (selectable) onAdd(selectable);
              onOpenChange(false);
            }}
          >
            Add field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
