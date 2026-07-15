import { Checkbox } from "@nextlyhq/ui";

import type { Permission } from "@admin/types/ui/form";

export interface PermissionMatrixCellProps {
  permission: Permission | undefined;
  checked: boolean;
  disabled: boolean;
  locked: boolean;
  contentTypeName: string;
  action: string;
  /** Id of the column header, for the checkbox's accessible name. */
  columnHeaderId?: string;
  /** Id of the row's name cell, for the checkbox's accessible name. */
  rowHeaderId?: string;
  onToggle: (id: string | undefined, checked: boolean) => void;
  className?: string;
}

export function PermissionMatrixCell({
  permission,
  checked,
  disabled,
  locked,
  contentTypeName,
  action,
  columnHeaderId,
  rowHeaderId,
  onToggle,
  // Width comes from the table's colgroup; this only handles spacing.
  className = "px-2 py-4 text-center  border-b border-border align-middle",
}: PermissionMatrixCellProps) {
  // No such permission, as opposed to one that exists and is not granted.
  // The dash is decorative: a screen reader voices "-" as nothing at all, so
  // the distinction has to be carried by text.
  if (!permission) {
    return (
      <td className={className}>
        <span
          aria-hidden="true"
          className="text-muted-foreground/40 font-medium"
        >
          -
        </span>
        <span className="sr-only">
          {`${action} does not apply to ${contentTypeName}`}
        </span>
      </td>
    );
  }

  // A permission that hands out access or takes data off the site. Marked in
  // the host's own words, not the plugin's, so that it reads the same wherever
  // it appears — a warning phrased forty different ways is one people stop
  // seeing. The mark rides on the checkbox's accessible name so it is not
  // colour alone, which would say nothing to a screen reader and nothing to
  // the monochrome admin either.
  const dangerNote = permission.danger
    ? `${action} ${contentTypeName} — grant with care, this gives access to data beyond this site`
    : undefined;

  return (
    <td className={className}>
      <Checkbox
        checked={checked}
        onCheckedChange={checked => onToggle(permission.id, !!checked)}
        disabled={disabled || locked}
        data-danger={permission.danger ? "true" : undefined}
        // Named by its column and row rather than a sentence built here, so
        // the pairing a sighted reader gets from position is the one a screen
        // reader announces. Falls back to a composed label where the ids are
        // not supplied.
        aria-labelledby={
          dangerNote || !(columnHeaderId && rowHeaderId)
            ? undefined
            : `${columnHeaderId} ${rowHeaderId}`
        }
        aria-label={
          dangerNote ??
          (columnHeaderId && rowHeaderId
            ? undefined
            : `${action} permission for ${contentTypeName}`)
        }
      />
    </td>
  );
}
