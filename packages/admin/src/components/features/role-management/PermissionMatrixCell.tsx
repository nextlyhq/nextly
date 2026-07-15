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

  return (
    <td className={className}>
      <Checkbox
        checked={checked}
        onCheckedChange={checked => onToggle(permission.id, !!checked)}
        disabled={disabled || locked}
        // Named by its column and row rather than a sentence built here, so
        // the pairing a sighted reader gets from position is the one a screen
        // reader announces. Falls back to a composed label where the ids are
        // not supplied.
        aria-labelledby={
          columnHeaderId && rowHeaderId
            ? `${columnHeaderId} ${rowHeaderId}`
            : undefined
        }
        aria-label={
          columnHeaderId && rowHeaderId
            ? undefined
            : `${action} permission for ${contentTypeName}`
        }
      />
    </td>
  );
}
