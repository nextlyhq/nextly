import * as SelectPrimitive from "@radix-ui/react-select";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";

/**
 * Select Component - Design System Specification
 *
 * Dropdown selection component for choosing from a list of options. Built on
 * Radix UI for robust accessibility and portal rendering.
 *
 * Accessibility:
 * - Full keyboard navigation (Arrow keys, Enter, Escape, Type-ahead)
 * - Proper ARIA attributes provided by Radix UI
 * - Screen reader announcements for selected value
 * - Focus management and keyboard shortcuts
 * - Disabled state support
 *
 * Design Specs:
 * - Height: sm=32px, default=40px, lg=44px (matches Input component)
 * - Padding: Horizontal 12px, vertical varies by size
 * - Border radius: 0px (rounded-none)
 * - Border: 1px solid, changes on focus/error
 * - Transition: 150ms (consistent with design system)
 * - Font size: sm/default=14px (text-sm), lg=16px (text-base)
 *
 * Size Variants:
 * - sm: Height 32px (h-8) - Compact forms, filters
 * - default: Height 40px (h-10) - Standard forms
 * - lg: Height 44px (h-11) - Prominent selects
 *
 * Features:
 * - Portal rendering via PortalProvider (avoids overflow issues)
 * - CheckIcon indicator for selected items
 * - Keyboard type-ahead search
 * - Grouping support with labels
 * - Placeholder text support
 * - Error state via aria-invalid
 */
function Select({ ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

const selectTriggerVariants = cva(
  "flex w-full items-center justify-between gap-2 rounded-none border border-input bg-background px-3 text-sm text-foreground cursor-pointer transition-all duration-150 focus:border-ring focus:outline-none hover:border-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-primary/5 data-[placeholder]:text-muted-foreground aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  {
    variants: {
      size: {
        sm: "h-8 text-sm",
        default: "h-10 text-sm",
        lg: "h-11 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

export interface SelectTriggerProps
  extends ComponentProps<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof selectTriggerVariants> {}

const SelectTrigger = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, size, children, ...props }, ref) => {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      data-slot="select-trigger"
      className={cn(selectTriggerVariants({ size, className }))}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

SelectTrigger.displayName = "SelectTrigger";

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  const portalContainer = usePortalContainer();

  return (
    <SelectPrimitive.Portal container={portalContainer}>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground border border-border shadow-none rounded-none z-9999 max-h-(--radix-select-content-available-height) min-w-32 overflow-hidden data-[state=open]:animate-zoom-in-95 data-[state=closed]:animate-zoom-out-95 data-[side=bottom]:animate-slide-in-from-top-2 data-[side=left]:animate-slide-in-from-right-2 data-[side=right]:animate-slide-in-from-left-2 data-[side=top]:animate-slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-none py-2 pr-8 pl-2 text-sm text-foreground outline-none select-none transition-colors hover-unified focus:bg-primary/10 focus:text-primary data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUp className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDown className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  selectTriggerVariants,
  SelectValue,
};
