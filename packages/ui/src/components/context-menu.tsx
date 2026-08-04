/**
 * ContextMenu Component
 *
 * A right-click menu built on Radix UI primitives. Same surface, items and keyboard model as
 * `DropdownMenu`; what differs is how it opens — a pointer's secondary button, a long press on
 * touch, or the platform's context-menu key — and that it opens AT the pointer rather than
 * anchored to a trigger element.
 *
 * **Why a separate component rather than a `DropdownMenu` with a different trigger**: the two
 * have different anchoring (a virtual point versus an element), different open semantics, and
 * different ARIA. Radix models them separately for that reason, and collapsing them would mean
 * reimplementing one of the two behaviours by hand.
 *
 * **Design specifications** (shared with `DropdownMenu`, so a right-click menu and a button menu
 * cannot drift apart):
 * - Border-radius: `rounded-lg` for the surface, `rounded-sm` for items
 * - Padding: 4px (p-1); item padding 8px horizontal, 6px vertical
 * - Shadow: `shadow-md`; z-index `z-50`; min-width 8rem
 * - Highlight: `bg-muted`, driven off `data-[highlighted]` so pointer and keyboard agree
 *
 * **Accessibility**:
 * - Opens on the context-menu event, so the keyboard route (Shift+F10, or the menu key) works
 *   without anything extra
 * - Full keyboard navigation (arrows, Enter, Escape, Home/End, typeahead)
 * - ARIA roles from Radix: `menu`, `menuitem`, `menuitemcheckbox`, `menuitemradio`
 * - Focus returns to the element that opened the menu on close
 *
 * **Portalling**: content renders into the container from `PortalProvider`, like every other
 * overlay in this kit. The scoped stylesheet only reaches inside `.nextly-ui`, and an overlay
 * portalled to `document.body` is outside it, so the provider is what keeps it styled.
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenuTrigger asChild>
 *     <div className="p-8">Right-click anywhere in here</div>
 *   </ContextMenuTrigger>
 *   <ContextMenuContent>
 *     <ContextMenuItem onSelect={duplicate}>Duplicate</ContextMenuItem>
 *     <ContextMenuItem onSelect={remove}>Delete</ContextMenuItem>
 *     <ContextMenuSeparator />
 *     <ContextMenuCheckboxItem checked={locked} onCheckedChange={setLocked}>
 *       Locked
 *     </ContextMenuCheckboxItem>
 *   </ContextMenuContent>
 * </ContextMenu>
 * ```
 *
 * @module
 */

"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";

/**
 * The item highlight, taken from the same reasoning as `DropdownMenu`: Radix sets
 * `data-highlighted` for both pointer hover and keyboard focus, so driving the highlight off
 * that one state keeps the two in sync, and `bg-muted` reads against the popover surface
 * without the full-contrast flip a solid `bg-primary` produces.
 */
const menuItemBase =
  "cursor-pointer transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

/** @experimental */
const ContextMenu = ContextMenuPrimitive.Root;

/** @experimental */
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

/** @experimental */
const ContextMenuGroup = ContextMenuPrimitive.Group;

/** @experimental */
const ContextMenuSub = ContextMenuPrimitive.Sub;

/** @experimental */
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/** @experimental */
const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[state=open]:bg-muted [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      menuItemBase,
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

/** @experimental */
const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => {
  const portalContainer = usePortalContainer();

  return (
    <ContextMenuPrimitive.Portal container={portalContainer}>
      <ContextMenuPrimitive.SubContent
        ref={ref}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 origin-[--radix-context-menu-content-transform-origin]",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

/** @experimental */
const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => {
  const portalContainer = usePortalContainer();

  return (
    <ContextMenuPrimitive.Portal container={portalContainer}>
      <ContextMenuPrimitive.Content
        ref={ref}
        className={cn(
          // The available-height variable bounds the menu to the space it actually has, so a
          // long menu opened near the bottom of the viewport scrolls instead of overflowing it.
          "z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 origin-[--radix-context-menu-content-transform-origin]",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

/** @experimental */
const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      menuItemBase,
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

/** @experimental */
const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none",
      menuItemBase,
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName;

/** @experimental */
const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none",
      menuItemBase,
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

/** @experimental */
const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold text-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

/** @experimental */
const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

/**
 * A keyboard shortcut hint, right-aligned in the item.
 *
 * @experimental
 */
const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "ml-auto text-xs tracking-widest text-muted-foreground",
      className
    )}
    {...props}
  />
);
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
