import { Checkbox } from "@revnixhq/ui";

import type { ContentTypePermissions } from "@admin/types/ui/form";

export interface PermissionMatrixHeaderProps {
  contentTypes: ContentTypePermissions[];
  disabled: boolean;
  lockedIds: string[];
  onToggleAction: (
    contentTypes: ContentTypePermissions[],
    action: keyof ContentTypePermissions["permissions"],
    checked: boolean
  ) => void;
  isAllSelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: keyof ContentTypePermissions["permissions"]
  ) => boolean;
  isPartiallySelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: keyof ContentTypePermissions["permissions"]
  ) => boolean;
}

export function PermissionMatrixHeader({
  contentTypes,
  disabled,
  lockedIds,
  onToggleAction,
  isAllSelectedForAction,
  isPartiallySelectedForAction,
}: PermissionMatrixHeaderProps) {
  const hasLockedCreate = contentTypes.some(
    ct => ct.permissions.create && lockedIds.includes(ct.permissions.create.id)
  );

  const hasLockedView = contentTypes.some(
    ct => ct.permissions.view && lockedIds.includes(ct.permissions.view.id)
  );

  const hasLockedEdit = contentTypes.some(
    ct => ct.permissions.edit && lockedIds.includes(ct.permissions.edit.id)
  );

  const hasLockedDelete = contentTypes.some(
    ct => ct.permissions.delete && lockedIds.includes(ct.permissions.delete.id)
  );

  const headerClass =
    "p-4 align-middle text-sm font-medium text-foreground border-b border-border bg-primary/5 backdrop-blur-sm sticky top-0 z-10";
  const actionClass =
    "p-4 align-middle text-sm font-medium text-foreground border-b border-border bg-primary/5 backdrop-blur-sm w-[120px] sticky top-0 z-10";

  return (
    <thead>
      <tr>
        <th className={`text-left ${headerClass} min-w-[200px]`}>
          <div className="flex items-center h-full">Name</div>
        </th>

        <th className={actionClass}>
          <div className="flex flex-row items-center justify-center gap-2 h-full">
            <Checkbox
              checked={isAllSelectedForAction(contentTypes, "create")}
              indeterminate={isPartiallySelectedForAction(
                contentTypes,
                "create"
              )}
              onCheckedChange={checked =>
                onToggleAction(contentTypes, "create", !!checked)
              }
              disabled={disabled || hasLockedCreate}
              aria-label="Toggle all create permissions"
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <span>Create</span>
          </div>
        </th>

        <th className={actionClass}>
          <div className="flex flex-row items-center justify-center gap-2 h-full">
            <Checkbox
              checked={isAllSelectedForAction(contentTypes, "view")}
              indeterminate={isPartiallySelectedForAction(contentTypes, "view")}
              onCheckedChange={checked =>
                onToggleAction(contentTypes, "view", !!checked)
              }
              disabled={disabled || hasLockedView}
              aria-label="Toggle all view permissions"
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <span>Read</span>
          </div>
        </th>

        <th className={actionClass}>
          <div className="flex flex-row items-center justify-center gap-2 h-full">
            <Checkbox
              checked={isAllSelectedForAction(contentTypes, "edit")}
              indeterminate={isPartiallySelectedForAction(contentTypes, "edit")}
              onCheckedChange={checked =>
                onToggleAction(contentTypes, "edit", !!checked)
              }
              disabled={disabled || hasLockedEdit}
              aria-label="Toggle all edit permissions"
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <span>Update</span>
          </div>
        </th>

        <th className={actionClass}>
          <div className="flex flex-row items-center justify-center gap-2 h-full">
            <Checkbox
              checked={isAllSelectedForAction(contentTypes, "delete")}
              indeterminate={isPartiallySelectedForAction(
                contentTypes,
                "delete"
              )}
              onCheckedChange={checked =>
                onToggleAction(contentTypes, "delete", !!checked)
              }
              disabled={disabled || hasLockedDelete}
              aria-label="Toggle all delete permissions"
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <span>Delete</span>
          </div>
        </th>
      </tr>
    </thead>
  );
}
