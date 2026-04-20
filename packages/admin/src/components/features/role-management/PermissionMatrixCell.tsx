import { Checkbox } from "@revnixhq/ui";

import type { Permission } from "@admin/types/ui/form";

export interface PermissionMatrixCellProps {
  permission: Permission | null;
  checked: boolean;
  disabled: boolean;
  locked: boolean;
  contentTypeName: string;
  action: string;
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
  onToggle,
  className = "p-4 text-center border-b border-border align-middle w-[120px]",
}: PermissionMatrixCellProps) {
  if (!permission) {
    return (
      <td className={className}>
        <span className="text-muted-foreground/40 font-medium">-</span>
      </td>
    );
  }

  return (
    <td className={className}>
      <Checkbox
        checked={checked}
        onCheckedChange={checked => onToggle(permission.id, !!checked)}
        disabled={disabled || locked}
        aria-label={`${action} permission for ${contentTypeName}`}
        className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
      />
    </td>
  );
}
