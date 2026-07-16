import { Checkbox } from "@nextlyhq/ui";

import { actionLabel } from "@admin/constants/permissions";
import {
  isEveryPermissionLocked,
  permissionIdsForAction,
} from "@admin/lib/permissions/calculations";
import type { ContentTypePermissions } from "@admin/types/ui/form";

export interface PermissionMatrixHeaderProps {
  contentTypes: ContentTypePermissions[];
  /** The tab's columns, resolved once by the table so rows line up with them. */
  actions: string[];
  disabled: boolean;
  lockedIds: string[];
  onToggleAction: (
    contentTypes: ContentTypePermissions[],
    action: string,
    checked: boolean
  ) => void;
  isAllSelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: string
  ) => boolean;
  isPartiallySelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: string
  ) => boolean;
}

export function PermissionMatrixHeader({
  contentTypes,
  actions,
  disabled,
  lockedIds,
  onToggleAction,
  isAllSelectedForAction,
  isPartiallySelectedForAction,
}: PermissionMatrixHeaderProps) {
  // Widths come from the table's colgroup, not from here, so the header and
  // body cannot disagree about them.
  const headerClass =
    "p-4 align-middle text-sm font-medium text-foreground  border-b border-border bg-primary/5 backdrop-blur-sm sticky top-0 z-10";
  const actionClass = `${headerClass} px-2`;

  return (
    <thead>
      <tr>
        <th id="permission-matrix-name" className={`text-left ${headerClass}`}>
          <div className="flex items-center h-full">Name</div>
        </th>

        {actions.map(action => {
          const allLocked = isEveryPermissionLocked(
            permissionIdsForAction(contentTypes, action),
            lockedIds
          );

          return (
            <th
              key={action}
              // Referenced by every checkbox in this column so a screen reader
              // announces the action alongside the row's name, rather than
              // "checkbox, not checked" thirty times over.
              id={`permission-column-${action}`}
              className={actionClass}
            >
              <div className="flex flex-row items-center justify-center gap-2 h-full">
                <Checkbox
                  checked={isAllSelectedForAction(contentTypes, action)}
                  indeterminate={isPartiallySelectedForAction(
                    contentTypes,
                    action
                  )}
                  onCheckedChange={checked =>
                    onToggleAction(contentTypes, action, !!checked)
                  }
                  disabled={disabled || allLocked}
                  aria-label={`Toggle all ${action} permissions`}
                />
                <span>{actionLabel(action)}</span>
              </div>
            </th>
          );
        })}

        {/* Absorbs the width the action columns don't need, so it lands here
            rather than inside Name. */}
        <th aria-hidden="true" className={headerClass} />
      </tr>
    </thead>
  );
}
