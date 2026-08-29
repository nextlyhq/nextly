"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Command as CommandPrimitive,
  defaultFilter,
  useCommandState as useCommandStatePrimitive,
} from "cmdk";
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
 * - Border radius: `rounded-lg` for the panel, `rounded-sm` for items
 * - Max list height: 400px (max-h-[400px])
 * - Transition: 150ms per design system
 *
 * @accessibility
 * - Full keyboard navigation (Arrow keys, Enter, Escape, Home, End)
 * - ARIA attributes (role="combobox", role="listbox", role="option")
 * - Screen reader announcements for results
 * - Focus management and visual focus indicators
 * - WCAG 2.2 AA compliant (verified contrast ratios)
 * @experimental
 */

export type CommandProps = ComponentPropsWithoutRef<typeof CommandPrimitive>;

/**
 * Command - Root container for the command palette.
 * Handles filtering, keyboard navigation, and accessibility.
 * @experimental
 */
const Command = forwardRef<ElementRef<typeof CommandPrimitive>, CommandProps>(
  ({ className, ...props }, ref) => (
    <CommandPrimitive
      ref={ref}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-background text-foreground",
        className
      )}
      {...props}
    />
  )
);
Command.displayName = "Command";

/** @experimental */
export interface CommandDialogProps extends DialogPrimitive.DialogProps {
  /**
   * Passed to the command root this dialog renders internally.
   *
   * A seam rather than a list of forwarded props, because the settings a caller needs from the
   * root are the ones this component happens not to have thought of: `label`, which supplies the
   * search input's accessible name (cmdk renders an EMPTY hidden label without it, and an empty
   * `aria-labelledby` reference is worse than none — it stops the placeholder naming the field);
   * `filter` and `shouldFilter`, which decide match order; and `vimBindings`, which claims Ctrl+K
   * and Ctrl+N inside the list.
   *
   * `children` is excluded because this component owns the dialog's contents.
   */
  commandProps?: Omit<ComponentPropsWithoutRef<typeof Command>, "children">;
  /**
   * Passed to the dialog content this component renders internally.
   *
   * The seam that matters here is `onCloseAutoFocus`: this dialog has no trigger, so Radix has
   * nothing to hand focus back to, and it fires this at the point focus is actually being
   * returned — after the exit animation, which a timer set at close time cannot know the length
   * of. `className` is excluded because this component owns the dialog's own layout.
   */
  contentProps?: Omit<
    ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    "children" | "className"
  >;
}

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
      // A modal scrim, from the `--nx-overlay` token rather than a surface
      // token. A black wash is the point — painting it from `background` would
      // make it a white veil in light mode — but the alpha still has to differ
      // per mode, because what it composites over is white in one and mid-tone
      // in the other.
      "fixed inset-0 z-[99] bg-overlay backdrop-blur-sm",
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
 * @experimental
 */
const CommandDialog = ({
  children,
  commandProps,
  contentProps,
  ...props
}: CommandDialogProps) => {
  const portalContainer = usePortalContainer();

  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal container={portalContainer}>
        <CommandDialogOverlay />
        <DialogPrimitive.Content
          {...contentProps}
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
            "overflow-hidden rounded-lg  border border-border bg-background shadow-xl",
            // Animation
            "duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]"
          )}
        >
          <Command
            {...commandProps}
            className={cn(
              "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:mb-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4",
              // Merged rather than overridden: a caller passing `className` for its own reason
              // would otherwise silently drop every layout rule this dialog depends on.
              commandProps?.className
            )}
          >
            {children}
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

/** @experimental */
export type CommandInputProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Input
>;

/**
 * CommandInput - Search input field for filtering commands.
 * Includes search icon and styled per design system.
 * @experimental
 */
const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, ...props }, ref) => (
  <div
    className="flex items-center  border-b border-border px-4"
    // cmdk-input-wrapper is the attribute the cmdk library targets
    // in its built-in stylesheet to scope wrapper-level styles.
    // Required by the library; not a typo.
    // eslint-disable-next-line react/no-unknown-property
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

/** @experimental */
export type CommandListProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.List
>;

/**
 * CommandList - Scrollable container for command results.
 * Max height 400px per design spec to prevent tall dialogs.
 * @experimental
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

/** @experimental */
export type CommandEmptyProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Empty
>;

/**
 * CommandEmpty - Empty state message when no results found.
 * Centered text with muted color per design spec.
 * @experimental
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

/** @experimental */
export type CommandGroupProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Group
>;

/**
 * CommandGroup - Grouped section of commands with optional heading.
 * Heading styled as uppercase, small, semibold per design spec.
 * @experimental
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

/** @experimental */
export type CommandSeparatorProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Separator
>;

/**
 * CommandSeparator - Visual divider between command groups.
 * 1px line with  border border-border color, 8px margin top/bottom.
 * @experimental
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

/** @experimental */
export type CommandItemProps = ComponentPropsWithoutRef<
  typeof CommandPrimitive.Item
>;

/**
 * CommandItem - Individual selectable command item.
 * Height: 36px desktop, 44px mobile per design spec.
 * Includes hover, focus, and selected states.
 * @experimental
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
      "rounded-sm text-base sm:text-sm outline-none",
      // Transitions
      "transition-all duration-200 ease-(--ease-premium)",
      // Hover state - shared dashboard hover treatment
      "hover-unified",
      // Selected/focused state (keyboard navigation)
      "aria-selected:bg-primary/5 aria-selected:text-primary",
      "data-[selected=true]:bg-primary/5 data-[selected=true]:text-primary",
      // Disabled state
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";

/** @experimental */
export type CommandShortcutProps = HTMLAttributes<HTMLSpanElement>;

/**
 * CommandShortcut - Keyboard shortcut display (e.g., "⌘K", "↵ Enter").
 * Monospace font, subtle background, right-aligned per design spec.
 * @experimental
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
          "border border-border rounded-md",
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

/**
 * The command palette's default match scorer, re-exported.
 *
 * A caller that overrides `filter` — to keep an opaque item value out of the scoring, say — still
 * wants the ranking that comes for free, and reaching for `cmdk` directly is not open to every
 * package here.
 *
 * Bound to a declaration rather than re-exported with `export { x as y }`: the bundler keeps a doc
 * comment attached to a declaration and drops one attached to an export statement, so the release
 * tag would not reach the published types.
 *
 * @experimental
 */
export const commandDefaultFilter = defaultFilter;

/**
 * Read the palette's OWN state from a component inside it.
 *
 * The palette owns which item is highlighted, and it moves that highlight for
 * reasons a caller never sees: a pointer crossing an item, an arrow key, and a
 * filter that removes the item the highlight was on. Anything outside wanting
 * to follow it — a preview pane, a description strip, a status line — needs to
 * read that state rather than keep a copy.
 *
 * Reading beats mirroring here for a specific reason rather than on principle.
 * The palette's controlled `value` sets which item is MARKED, and does not move
 * the internal cursor that `aria-activedescendant` and the scroll follow. So a
 * caller that writes the value to steer the highlight desynchronises the two:
 * the tile drawn as current and the option announced as current stop agreeing,
 * and after a filter the announcement can name an element that has been
 * removed. A selector leaves one owner and takes a derived view.
 *
 * Must be called from inside the palette, since that is where the state lives.
 *
 * Bound to a declaration rather than re-exported with `export { x as y }`: the
 * bundler keeps a doc comment attached to a declaration and drops one attached
 * to an export statement, so the release tag would not reach the published
 * types.
 *
 * @experimental
 */
export const useCommandState = useCommandStatePrimitive;
