import { Checkbox } from "@revnixhq/ui";

import { cn } from "@admin/lib/utils";
import type { ContentTypePermissions } from "@admin/types/ui/form";

import { PermissionMatrixCell } from "./PermissionMatrixCell";

export interface PermissionMatrixRowProps {
  contentType: ContentTypePermissions;
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
  value,
  lockedIds,
  disabled,
  onToggle,
  onToggleAll,
  isAllSelected,
  isPartiallySelected,
}: PermissionMatrixRowProps) {
  const hasLockedPermissions = Object.values(contentType.permissions).some(
    permission => permission && lockedIds.includes(permission.id)
  );

  return (
    <tr
      className={cn(
        "bg-card hover-unified transition-colors",
        isAllSelected && "bg-primary/5 hover-unified"
      )}
    >
      {/* Content Type Name with Row Checkbox */}
      <td className="p-4 align-middle  border-b border-primary/5 min-w-[200px]">
        <div className="flex items-center space-x-4">
          <Checkbox
            checked={isAllSelected}
            indeterminate={isPartiallySelected}
            onCheckedChange={checked => onToggleAll(contentType, !!checked)}
            disabled={disabled || hasLockedPermissions}
            aria-label={`Toggle all permissions for ${contentType.name}`}
            className="border-primary/5 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
          />
          <span className="font-medium text-sm text-foreground capitalize">
            {contentType.name}
          </span>
        </div>
      </td>

      {/* Create Permission Cell */}
      <PermissionMatrixCell
        permission={contentType.permissions.create}
        checked={
          contentType.permissions.create
            ? value.includes(contentType.permissions.create.id)
            : false
        }
        disabled={disabled}
        locked={
          contentType.permissions.create
            ? lockedIds.includes(contentType.permissions.create.id)
            : false
        }
        contentTypeName={contentType.name}
        action="Create"
        onToggle={onToggle}
      />

      {/* View Permission Cell */}
      <PermissionMatrixCell
        permission={contentType.permissions.view}
        checked={
          contentType.permissions.view
            ? value.includes(contentType.permissions.view.id)
            : false
        }
        disabled={disabled}
        locked={
          contentType.permissions.view
            ? lockedIds.includes(contentType.permissions.view.id)
            : false
        }
        contentTypeName={contentType.name}
        action="Read"
        onToggle={onToggle}
      />

      {/* Edit Permission Cell */}
      <PermissionMatrixCell
        permission={contentType.permissions.edit}
        checked={
          contentType.permissions.edit
            ? value.includes(contentType.permissions.edit.id)
            : false
        }
        disabled={disabled}
        locked={
          contentType.permissions.edit
            ? lockedIds.includes(contentType.permissions.edit.id)
            : false
        }
        contentTypeName={contentType.name}
        action="Update"
        onToggle={onToggle}
      />

      {/* Delete Permission Cell (no right border) */}
      <PermissionMatrixCell
        permission={contentType.permissions.delete}
        checked={
          contentType.permissions.delete
            ? value.includes(contentType.permissions.delete.id)
            : false
        }
        disabled={disabled}
        locked={
          contentType.permissions.delete
            ? lockedIds.includes(contentType.permissions.delete.id)
            : false
        }
        contentTypeName={contentType.name}
        action="Delete"
        onToggle={onToggle}
        className="p-4 text-center  border-b border-primary/5 align-middle w-[120px]"
      />
    </tr>
  );
}
