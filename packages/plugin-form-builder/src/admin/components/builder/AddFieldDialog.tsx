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
import type {
  FieldTypeCatalogEntry,
  FormFieldCatalogType,
} from "nextly/field-catalog";
import { useState } from "react";

export interface AddFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The form surface's catalog, already filtered by the host's excludes. */
  entries: readonly FieldTypeCatalogEntry<FormFieldCatalogType>[];
  /** Called with the chosen type; the parent creates and selects the field. */
  onAdd: (type: FormFieldCatalogType) => void;
}

export function AddFieldDialog({
  open,
  onOpenChange,
  entries,
  onAdd,
}: AddFieldDialogProps) {
  const [selected, setSelected] = useState<FormFieldCatalogType>("text");

  const selectable = entries.some(entry => entry.type === selected)
    ? selected
    : entries[0]?.type;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add field</DialogTitle>
          <DialogDescription>
            Pick the field type. Everything else is edited on the field card.
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
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
