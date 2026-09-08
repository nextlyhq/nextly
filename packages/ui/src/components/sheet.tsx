"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";
import type { SheetProps } from "../types/sheet";

/**
 * Whether the enclosing sheet is modal, published to its own parts.
 *
 * Radix takes `modal` at the root and uses it to decide focus trapping and
 * whether the rest of the page is withdrawn from the accessibility tree. The
 * scrim is that same decision expressed visually, and it is rendered a level
 * down in `SheetContent`. Passing the root's answer down — rather than giving
 * the content a second prop of its own — keeps one answer to one question: a
 * caller cannot ask for a non-modal sheet and still get a scrim over the page
 * it deliberately left interactive.
 *
 * Declared above the component doc blocks on purpose. The bundler attaches a
 * doc comment to the declaration that follows it, so anything inserted between
 * a tagged comment and its declaration silently steals the tag.
 */
const SheetModalContext = React.createContext(true);

// Note: the close icon is not rendered by default here. Consumers should import and render their preferred icon with `SheetClose`.

/**
 * Sheet Component
 *
 * A dialog variant that slides in from the edges of the screen. Used for mobile
 * navigation drawers, side panels, and contextual overlays.
 *
 * Built on Radix UI Dialog with slide-in animations and overlay backdrop.
 *
 * ## Design Specifications
 *
 * - **Width**: 320px (sm), 400px (default), 512px (lg), 672px (xl), 100% (full)
 * - **Animation**: Slide-in from side (150ms duration)
 * - **Backdrop**: the `--nx-overlay` scrim, with backdrop blur
 * - **z-index**: 50 (both overlay and content - content renders on top via DOM order)
 * - **Border-radius**: 0 (full-screen edges)
 *
 * ## Accessibility
 *
 * - **Focus Trapping**: Focus is trapped within the sheet when open
 * - **Escape Key**: Closes sheet on Escape key press
 * - **Overlay Click**: Closes sheet when clicking outside
 * - **ARIA**: Proper dialog role and ARIA attributes
 * - **Keyboard Navigation**: Tab/Shift+Tab to navigate, Enter to activate
 *
 * ## Usage Examples
 *
 * ### Basic Mobile Navigation Drawer
 *
 * ```tsx
 * import { Sheet, SheetContent, SheetTrigger } from '@nextlyhq/ui';
 * import { Menu } from 'lucide-react';
 *
 * function MobileNav() {
 *   return (
 *     <Sheet>
 *       <SheetTrigger asChild>
 *         <button className="h-11 w-11 md:hidden">
 *           <Menu />
 *         </button>
 *       </SheetTrigger>
 *       <SheetContent side="left" className="w-72">
 *         <nav>
 *           <a href="/dashboard">Dashboard</a>
 *           <a href="/users">Users</a>
 *         </nav>
 *       </SheetContent>
 *     </Sheet>
 *   );
 * }
 * ```
 *
 * @see https://www.radix-ui.com/primitives/docs/components/dialog
 * @public
 */
const Sheet = ({ modal = true, children, ...props }: SheetProps) => (
  <SheetModalContext.Provider value={modal}>
    <DialogPrimitive.Root modal={modal} {...props}>
      {children}
    </DialogPrimitive.Root>
  </SheetModalContext.Provider>
);
Sheet.displayName = "Sheet";

/** @experimental */
const SheetTrigger = DialogPrimitive.Trigger;

/** @experimental */
const SheetClose = DialogPrimitive.Close;

/** @experimental */
const SheetPortal = DialogPrimitive.Portal;

/**
 * SheetOverlay
 *
 * Semi-transparent backdrop that appears behind the sheet.
 *
 * - **Background**: the `--nx-overlay` scrim + backdrop blur
 * - **Animation**: Fade in/out (150ms)
 * - **z-index**: 50
 * @experimental
 */
const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    data-slot="sheet-overlay"
    className={cn(
      // A modal scrim, from the `--nx-overlay` token rather than a surface
      // token. A black wash is the point — painting it from `background` would
      // make it a white veil in light mode — but the alpha still has to differ
      // per mode, because what it composites over is white in one and mid-tone
      // in the other.
      "fixed inset-0 z-50 bg-overlay backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Sheet Content Variants
 *
 * Defines slide-in animations for each side and size options.
 * @experimental
 */
const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg will-change-transform transition ease-in-out data-[state=closed]:duration-150 data-[state=open]:duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0  border-b border-border data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0  border-t border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4  border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
);

/** @public */
export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

/**
 * SheetContent
 *
 * Main content container for the sheet.
 *
 * - **Position**: Fixed to screen edge (side prop)
 * - **Width**: Responsive (w-3/4 on mobile, max-w-sm on sm+)
 * - **Padding**: 24px (p-6)
 * - **Border**: On appropriate edge based on side
 * - **Close Button**: Positioned in top-right corner (16px from edges)
 *
 * @param side - Which edge to slide in from: "left", "right", "top", "bottom"
 * @public
 */
const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => {
  const portalContainer = usePortalContainer();
  // Taken from the root rather than from a prop here: the scrim and Radix's
  // inerting are the same decision, and two places to state it would let a
  // sheet scrim a page it had left interactive.
  const modal = React.useContext(SheetModalContext);

  return (
    <SheetPortal container={portalContainer}>
      {modal ? <SheetOverlay /> : null}
      <DialogPrimitive.Content
        ref={ref}
        data-slot="sheet-content"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = DialogPrimitive.Content.displayName;

/**
 * SheetHeader
 *
 * Header section for sheet title and description.
 *
 * - **Layout**: Flex column with 6px gap
 * - **Text Alignment**: Left (default) or center
 * @public
 */
const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

/**
 * SheetFooter
 *
 * Footer section for sheet actions (buttons, etc.).
 *
 * - **Layout**: Flex row on desktop, column on mobile
 * - **Alignment**: Right-aligned on desktop, stretched on mobile
 * @experimental
 */
const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

/**
 * SheetTitle
 *
 * Title heading for the sheet (h2).
 *
 * - **Font**: text-lg font-semibold
 * - **Color**: text-foreground
 * - **Required**: For accessibility (screen readers)
 * @public
 */
const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

/**
 * SheetDescription
 *
 * Description text for the sheet.
 *
 * - **Font**: text-sm
 * - **Color**: text-muted-foreground
 * - **Purpose**: Provide context for screen readers
 * @public
 */
const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  sheetVariants,
};
