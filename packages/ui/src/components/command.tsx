"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type {
  ElementRef,
  ComponentPropsWithoutRef,
  HTMLAttributes,
} from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";

/**
 * Command Component
 *
 * A command palette component built on cmdk for fast, keyboard-driven navigation and actions.
 * Supports fuzzy search, keyboard navigation, and WCAG 2.2 AA accessibility.
 *
 * @example
 * ```tsx
 * <Command>
 *   <CommandInput placeholder="Type a command or search..." />
 *   <CommandList>
 *     <CommandEmpty>No results found.</CommandEmpty>
 *     <CommandGroup heading="Navigation">
 *       <CommandItem>
 *         <Home className="mr-2 h-4 w-4" />
 *         Dashboard
 *       </CommandItem>
 *     </CommandGroup>
 *   </CommandList>
 * </Command>
 * ```
 *
 * @design-spec
 * - Input height: 48px (h-12) - larger for prominence
 * - Item height: 36px (h-9) desktop, 44px (h-11) mobile for touch
 * - Border radius: 0px (rounded-none) for items
 * - Max list height: 400px (max-h-[400px])
 * - Transition: 150ms per design system
 *
 * @accessibility
 * - Full keyboard navigation (Arrow keys, Enter, Escape, Home, End)
 * - ARIA attributes (role="combobox", role="listbox", role="option")
 * - Screen reader announcements for results
 * - Focus management and visual focus indicators
 * - WCAG 2.2 AA compliant (verified contrast ratios)
 */

export type CommandProps = ComponentPropsWithoutRef<typeof CommandPrimitive>;

/**
 * Command - Root container for the command palette.
 * Handles filtering, keyboard navigation, and accessibility.
 */
const Command = forwardRef<ElementRef<typeof CommandPrimitive>, CommandProps>(
  ({ className, ...props }, ref) => (
    <CommandPrimitive
      ref={ref}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-none bg-background text-foreground",
        className
      )}
      {...props}
    />
  )
);
Command.displayName = "Command";

export type CommandDialogProps = DialogPrimitive.DialogProps;

/**
 * CommandDialogOverlay - Custom overlay for CommandDialog with proper z-index.
 * Uses z-[99] to stay below CommandDialog content (z-[100]) but above regular dialogs.
 */
const CommandDialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[99] bg-black/80 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "transition-opacity duration-200",
      className
    )}
    {...props}
  />
));
CommandDialogOverlay.displayName = "CommandDialogOverlay";

/**
 * CommandDialog - Command palette in a modal dialog.
 * Use this variant for Cmd+K keyboard shortcut pattern.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false)
 *
 * useEffect(() => {
 *   const down = (e: KeyboardEvent) => {
 *     if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
 *       e.preventDefault()
 *       setOpen((open) => !open)
 *     }
 *   }
 *   document.addEventListener("keydown", down)
 *   return () => document.removeEventListener("keydown", down)
 * }, [])
 *
 * return (
 *   <CommandDialog open={open} onOpenChange={setOpen}>
 *     <CommandInput placeholder="Type a command..." />
 *     <CommandList>...</CommandList>
 *   </CommandDialog>
 * )
 * ```
 */
const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
  const portalContainer = usePortalContainer();

  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal container={portalContainer}>
        <CommandDialogOverlay />
        <DialogPrimitive.Content
          data-slot="command-content"
          className={cn(
            // Position
            "fixed left-[50%] top-[50%] z-[100] translate-x-[-50%] translate-y-[-50%]",
            // Size - responsive
            "w-full max-w-lg",
            "max-h-[85vh]", // Slightly shorter than design spec to ensure safe area
            // Mobile adjustments
            "sm:max-w-lg", // 512px on desktop
            "max-w-full", // Full width on mobile
            // Spacing
            "m-4 sm:m-0", // 16px margin on mobile, no margin on desktop
            // Visual
            "overflow-hidden rounded-none border border-border bg-background shadow-xl",
            // Animation
            "duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]"
          )}
        >
          <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:mb-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4">
            {children}
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export type CommandInputProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Input
>;

/**
 * CommandInput - Search input field for filtering commands.
 * Includes search icon and styled per design system.
 */
const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, ...props }, ref) => (
  <div
    className="flex items-center border-b border-border px-4"
    cmdk-input-wrapper=""
  >
    <Search className="mr-3 h-5 w-5 shrink-0 text-muted-foreground" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        // Size
        "flex h-12 w-full",
        // Visual
        "bg-transparent text-base",
        "outline-none",
        // Typography
        "placeholder:text-muted-foreground",
        // States
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Prevent iOS zoom on focus
        "text-base md:text-sm",
        className
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = "CommandInput";

export type CommandListProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.List
>;

/**
 * CommandList - Scrollable container for command results.
 * Max height 400px per design spec to prevent tall dialogs.
 */
const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  CommandListProps
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      // Scroll
      "max-h-[400px] overflow-y-auto overflow-x-hidden",
      // Spacing
      "p-2",
      className
    )}
    {...props}
  />
));
CommandList.displayName = "CommandList";

export type CommandEmptyProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Empty
>;

/**
 * CommandEmpty - Empty state message when no results found.
 * Centered text with muted color per design spec.
 */
const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  CommandEmptyProps
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-8 px-4 text-center text-sm text-muted-foreground"
    {...props}
  />
));
CommandEmpty.displayName = "CommandEmpty";

export type CommandGroupProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Group
>;

/**
 * CommandGroup - Grouped section of commands with optional heading.
 * Heading styled as uppercase, small, semibold per design spec.
 */
const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  CommandGroupProps
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      // Spacing
      "space-y-1 mb-2",
      // Heading styling applied via parent Command className
      "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = "CommandGroup";

export type CommandSeparatorProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Separator
>;

/**
 * CommandSeparator - Visual divider between command groups.
 * 1px line with border color, 8px margin top/bottom.
 */
const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  CommandSeparatorProps
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("h-px bg-border my-2", className)}
    {...props}
  />
));
CommandSeparator.displayName = "CommandSeparator";

export type CommandItemProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Item
>;

/**
 * CommandItem - Individual selectable command item.
 * Height: 36px desktop, 44px mobile per design spec.
 * Includes hover, focus, and selected states.
 */
const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  CommandItemProps
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      // Layout
      "relative flex cursor-pointer select-none items-center gap-3",
      // Size
      "min-h-[44px] sm:min-h-[36px]", // Flexible height with minimal touch targets
      // Spacing
      "px-3 py-2.5",
      // Visual
      "rounded-none text-base sm:text-sm outline-none",
      // Transitions
      "transition-all duration-200 ease-(--ease-premium)",
      // Hover state - shared dashboard hover treatment
      "hover-unified",
      // Selected/focused state (keyboard navigation)
      "aria-selected:bg-primary/10 aria-selected:text-primary",
      "data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary",
      // Disabled state
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";

export type CommandShortcutProps = HTMLAttributes<HTMLSpanElement>;

/**
 * CommandShortcut - Keyboard shortcut display (e.g., "⌘K", "↵ Enter").
 * Monospace font, subtle background, right-aligned per design spec.
 */
const CommandShortcut = forwardRef<HTMLSpanElement, CommandShortcutProps>(
  ({ className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          // Position
          "ml-auto",
          // Typography
          "text-xs font-mono",
          // Visual
          "text-muted-foreground bg-primary/5",
          "border border-border rounded-none",
          // Spacing
          "px-1.5 py-0.5",
          className
        )}
        {...props}
      />
    );
  }
);
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
