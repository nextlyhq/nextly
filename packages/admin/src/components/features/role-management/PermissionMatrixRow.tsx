import { Checkbox } from "@nextlyhq/ui";

import {
  isEveryPermissionLocked,
  permissionIdsForContentType,
} from "@admin/lib/permissions/calculations";
import { cn } from "@admin/lib/utils";
import type { ContentTypePermissions } from "@admin/types/ui/form";

import { PermissionMatrixCell } from "./PermissionMatrixCell";

export interface PermissionMatrixRowProps {
  contentType: ContentTypePermissions;
  /** The tab's columns, so every row lines up with the header. */
  actions: string[];
  value: string[];
  lockedIds: string[];
  disabled: boolean;
  onToggle: (id: string | undefined, checked: boolean) => void;
  onToggleAll: (contentType: ContentTypePermissions, checked: boolean) => void;
  isAllSelected: boolean;
  isPartiallySelected: boolean;
}

export function PermissionMatrixRow({
  contentType,
  actions,
  value,
  lockedIds,
  disabled,
  onToggle,
  onToggleAll,
  isAllSelected,
  isPartiallySelected,
}: PermissionMatrixRowProps) {
  const allLocked = isEveryPermissionLocked(
    permissionIdsForContentType(contentType),
    lockedIds
  );
  const rowHeaderId = `permission-row-${contentType.id}`;

  return (
    <tr
      className={cn(
        "bg-card hover-unified transition-colors",
        isAllSelected && "bg-primary/5 hover-unified"
      )}
    >
      <td className="p-4 align-middle  border-b border-border">
        <div className="flex items-center space-x-4">
          <Checkbox
            checked={isAllSelected}
            indeterminate={isPartiallySelected}
            onCheckedChange={checked => onToggleAll(contentType, !!checked)}
            disabled={disabled || allLocked}
            aria-label={`Toggle all permissions for ${contentType.name}`}
          />
          <span
            id={rowHeaderId}
            className="font-medium text-sm text-foreground capitalize"
          >
            {contentType.name}
          </span>
        </div>
      </td>

      {actions.map(action => {
        const permission = contentType.permissions[action];

        return (
          <PermissionMatrixCell
            key={action}
            permission={permission}
            checked={permission ? value.includes(permission.id) : false}
            disabled={disabled}
            locked={permission ? lockedIds.includes(permission.id) : false}
            contentTypeName={contentType.name}
            action={action}
            columnHeaderId={`permission-column-${action}`}
            rowHeaderId={rowHeaderId}
            onToggle={onToggle}
          />
        );
      })}

      {/* Pairs with the header's spacer; carries the row's rule to the edge. */}
      <td className="border-b border-border" />
    </tr>
  );
}
