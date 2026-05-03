import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type {
  ElementRef,
  ComponentPropsWithoutRef,
  HTMLAttributes,
} from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";

/**
 * Dialog (Modal) Component
 *
 * A composable dialog component built on Radix UI primitives for creating modal windows.
 * Supports keyboard navigation, focus trapping, and WCAG 2.2 AA accessibility.
 *
 * @example
 * ```tsx
 * <Dialog open={open} onOpenChange={setOpen}>
 *   <DialogTrigger asChild>
 *     <Button>Open Dialog</Button>
 *   </DialogTrigger>
 *   <DialogContent size="md">
 *     <DialogHeader>
 *       <DialogTitle>Edit Profile</DialogTitle>
 *       <DialogDescription>
 *         Make changes to your profile here. Click save when you're done.
 *       </DialogDescription>
 *     </DialogHeader>
 *     <div className="space-y-4">
 *       Your content here
 *     </div>
 *     <DialogFooter>
 *       <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
 *       <Button type="submit">Save Changes</Button>
 *     </DialogFooter>
 *   </DialogContent>
 * </Dialog>
 * ```
 *
 * @design-spec
 * - Border-radius: 0px (rounded-none) per design system spec
 * - Max-width: 512px (default), responsive sizes available
 * - Backdrop: black/80 with blur effect
 * - Padding: 24px (p-6)
 * - Shadow: xl for prominence (elevation level 4)
 * - Transition: 150ms per design system
 * - Z-index: Overlay at z-50, Content at z-51 (ensures content above overlay)
 *
 * @accessibility
 * - Focus is trapped inside dialog when open
 * - Pressing Escape closes the dialog
 * - Focus returns to trigger element on close
 * - Includes ARIA labels and descriptions
 * - Screen reader announcements via role="dialog"
 * - Close button has sr-only text for screen readers
 */

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

export type DialogOverlayProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Overlay
>;

/**
 * DialogOverlay - The backdrop overlay behind the dialog content.
 * Renders with black/80 opacity and blur effect per design spec.
 */
const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm transition-opacity duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Dialog content size variants using CVA.
 *
 * @variant sm - Small dialog (384px / max-w-sm) - confirmations, alerts
 * @variant md - Medium dialog (512px / max-w-lg) - default, standard forms
 * @variant lg - Large dialog (672px / max-w-2xl) - complex forms, data tables
 * @variant xl - Extra large dialog (896px / max-w-4xl) - content editors, media galleries
 * @variant full - Full width with margin (responsive) - fullscreen on mobile
 */
const dialogContentVariants = cva("", {
  variants: {
    size: {
      sm: "max-w-sm",
      md: "max-w-lg",
      lg: "max-w-2xl",
      xl: "max-w-4xl",
      full: "max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-4rem)]",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export type DialogContentProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> &
  VariantProps<typeof dialogContentVariants>;

/**
 * DialogContent - The main dialog content container.
 *
 * @param size - Size variant (sm, md, lg, xl, full). Default: md (512px)
 *
 * @example
 * ```tsx
 * <DialogContent size="lg">
 *   Your content here
 * </DialogContent>
 * ```
 */
const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, ...props }, ref) => {
  const portalContainer = usePortalContainer();

  return (
    <DialogPortal container={portalContainer}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "fixed left-[50%] top-[50%] z-[51] grid w-full translate-x-[-50%] translate-y-[-50%] gap-4  border border-primary/5 bg-background p-6 shadow-xl rounded-none duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          dialogContentVariants({ size }),
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute right-4 top-4 rounded-none p-1 text-muted-foreground cursor-pointer transition-colors duration-150 hover-unified focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export type DialogHeaderProps = HTMLAttributes<HTMLDivElement>;

/**
 * DialogHeader - Container for dialog title and description.
 * Provides consistent spacing and alignment (centered on mobile, left-aligned on desktop).
 */
const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        className
      )}
      {...props}
    />
  )
);
DialogHeader.displayName = "DialogHeader";

export type DialogFooterProps = HTMLAttributes<HTMLDivElement>;

/**
 * DialogFooter - Container for dialog action buttons.
 * Provides consistent spacing and alignment (vertical on mobile, horizontal on desktop).
 *
 * @example
 * ```tsx
 * <DialogFooter>
 *   <Button variant="outline" onClick={onCancel}>Cancel</Button>
 *   <Button type="submit">Save Changes</Button>
 * </DialogFooter>
 * ```
 */
const DialogFooter = forwardRef<HTMLDivElement, DialogFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className
      )}
      {...props}
    />
  )
);
DialogFooter.displayName = "DialogFooter";

export type DialogTitleProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Title
>;

/**
 * DialogTitle - The title of the dialog.
 * Uses text-lg (18px) with semibold weight per design system.
 *
 * @accessibility Required for screen readers. Always include a DialogTitle.
 */
const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  DialogTitleProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export type DialogDescriptionProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>;

/**
 * DialogDescription - The description text of the dialog.
 * Uses text-sm (14px) with muted color per design system.
 *
 * @accessibility Provides additional context for screen readers.
 * If not needed visually, you can use sr-only class.
 */
const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  DialogDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  dialogContentVariants,
};
