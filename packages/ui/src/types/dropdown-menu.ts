import type * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type * as React from "react";

/**
 * Props for the DropdownMenuSubTrigger component
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
 */
export type DropdownMenuSubContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubContent
>;

/**
 * Props for the DropdownMenuContent component
 */
export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
>;

/**
 * Props for the DropdownMenuItem component
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
 */
export type DropdownMenuCheckboxItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

/**
 * Props for the DropdownMenuRadioItem component
 */
export type DropdownMenuRadioItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioItem
>;

/**
 * Props for the DropdownMenuLabel component
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
 */
export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
>;

/**
 * Props for the DropdownMenuShortcut component
 */
export type DropdownMenuShortcutProps = React.HTMLAttributes<HTMLSpanElement>;
