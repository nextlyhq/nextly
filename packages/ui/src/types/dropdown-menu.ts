import type * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type * as React from "react";

/**
 * Props for the DropdownMenuSubTrigger component
 * @experimental
 */
export type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubTrigger
> & {
  /**
   * Whether to add left padding (for alignment with items that have icons)
   */
  inset?: boolean;
};

/**
 * Props for the DropdownMenuSubContent component
 * @experimental
 */
export type DropdownMenuSubContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubContent
>;

/**
 * Props for the DropdownMenuContent component
 * @public
 */
export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
>;

/**
 * Props for the DropdownMenuItem component
 * @public
 */
export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> & {
  /**
   * Whether to add left padding (for alignment with items that have icons)
   */
  inset?: boolean;
};

/**
 * Props for the DropdownMenuCheckboxItem component
 * @public
 */
export type DropdownMenuCheckboxItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

/**
 * Props for the DropdownMenuRadioItem component
 * @experimental
 */
export type DropdownMenuRadioItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioItem
>;

/**
 * Props for the DropdownMenuLabel component
 * @experimental
 */
export type DropdownMenuLabelProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Label
> & {
  /**
   * Whether to add left padding (for alignment with items that have icons)
   */
  inset?: boolean;
};

/**
 * Props for the DropdownMenuSeparator component
 * @public
 */
export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
>;

/**
 * Props for the DropdownMenuShortcut component
 * @experimental
 */
export type DropdownMenuShortcutProps = React.HTMLAttributes<HTMLSpanElement>;
