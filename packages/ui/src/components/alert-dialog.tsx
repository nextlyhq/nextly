/**
 * AlertDialog Component
 *
 * A modal dialog for important confirmations that require user acknowledgment.
 * Built on Radix UI primitives. Its confirming action is primary; pass
 * `variant="destructive"` only when confirming deletes data.
 *
 * @example
 * ```tsx
 * <AlertDialog open={open} onOpenChange={setOpen}>
 *   <AlertDialogTrigger asChild>
 *     <Button variant="destructive">Delete</Button>
 *   </AlertDialogTrigger>
 *   <AlertDialogContent>
 *     <AlertDialogHeader>
 *       <AlertDialogTitle>Are you sure?</AlertDialogTitle>
 *       <AlertDialogDescription>
 *         This action cannot be undone.
 *       </AlertDialogDescription>
 *     </AlertDialogHeader>
 *     <AlertDialogFooter>
 *       <AlertDialogCancel>Cancel</AlertDialogCancel>
 *       <AlertDialogAction variant="destructive" onClick={handleDelete}>
 *         Delete
 *       </AlertDialogAction>
 *     </AlertDialogFooter>
 *   </AlertDialogContent>
 * </AlertDialog>
 * ```
 *
 * @design-spec
 * - Border-radius: `rounded-lg`, the container step of the `--radius` scale
 * - Max-width: 512px (default)
 * - Backdrop: the `--nx-overlay` scrim with blur effect
 * - Padding: 24px (p-6)
 * - Shadow: xl for prominence
 *
 * @accessibility
 * - Focus is trapped inside dialog when open
 * - Pressing Escape closes the dialog
 * - Focus returns to trigger element on close
 * - Screen reader announcements via role="alertdialog"
 */

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import {
  forwardRef,
  type ElementRef,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type RefAttributes,
} from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";

import { buttonVariants } from "./button";

/** @experimental */
const AlertDialog: typeof AlertDialogPrimitive.Root = AlertDialogPrimitive.Root;

/** @experimental */
const AlertDialogTrigger: typeof AlertDialogPrimitive.Trigger =
  AlertDialogPrimitive.Trigger;

/** @experimental */
const AlertDialogPortal: typeof AlertDialogPrimitive.Portal =
  AlertDialogPrimitive.Portal;

/** @experimental */
export type AlertDialogOverlayProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Overlay
>;

/**
 * AlertDialogOverlay - The backdrop overlay behind the dialog content.
 * @experimental
 */
const AlertDialogOverlay: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogOverlayProps> &
    RefAttributes<ElementRef<typeof AlertDialogPrimitive.Overlay>>
> = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Overlay>,
  AlertDialogOverlayProps
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // A modal scrim, from the `--nx-overlay` token rather than a surface
      // token. A black wash is the point — painting it from `background` would
      // make it a white veil in light mode — but the alpha still has to differ
      // per mode, because what it composites over is white in one and mid-tone
      // in the other.
      "fixed inset-0 z-50 bg-overlay backdrop-blur-sm transition-opacity duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

/** @experimental */
export type AlertDialogContentProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
>;

/**
 * AlertDialogContent - The main dialog content container.
 * @experimental
 */
const AlertDialogContent: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogContentProps> &
    RefAttributes<ElementRef<typeof AlertDialogPrimitive.Content>>
> = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(({ className, ...props }, ref) => {
  const portalContainer = usePortalContainer();

  return (
    <AlertDialogPortal container={portalContainer}>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-[51] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4  border border-border bg-background p-6 shadow-xl rounded-lg duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

/** @experimental */
export type AlertDialogHeaderProps = HTMLAttributes<HTMLDivElement>;

/**
 * AlertDialogHeader - Container for dialog title and description.
 * @experimental
 */
const AlertDialogHeader: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogHeaderProps> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, AlertDialogHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col space-y-2 text-center sm:text-left",
        className
      )}
      {...props}
    />
  )
);
AlertDialogHeader.displayName = "AlertDialogHeader";

/** @experimental */
export type AlertDialogFooterProps = HTMLAttributes<HTMLDivElement>;

/**
 * AlertDialogFooter - Container for dialog action buttons.
 * @experimental
 */
const AlertDialogFooter: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogFooterProps> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, AlertDialogFooterProps>(
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
AlertDialogFooter.displayName = "AlertDialogFooter";

/** @experimental */
export type AlertDialogTitleProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Title
>;

/**
 * AlertDialogTitle - The title of the alert dialog.
 * @experimental
 */
const AlertDialogTitle: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogTitleProps> &
    RefAttributes<ElementRef<typeof AlertDialogPrimitive.Title>>
> = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Title>,
  AlertDialogTitleProps
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

/** @experimental */
export type AlertDialogDescriptionProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Description
>;

/**
 * AlertDialogDescription - The description text of the alert dialog.
 * @experimental
 */
const AlertDialogDescription: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogDescriptionProps> &
    RefAttributes<ElementRef<typeof AlertDialogPrimitive.Description>>
> = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Description>,
  AlertDialogDescriptionProps
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;

/** @experimental */
export type AlertDialogActionProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Action
> & {
  /**
   * `"destructive"` when confirming deletes data; anything else a dialog
   * confirms (a save, a publish, a restore) stays `"primary"`, the default.
   */
  variant?: "primary" | "destructive";
};

/**
 * AlertDialogAction - The confirming action button (e.g., "Save", "Delete").
 * Primary by default: red is kept for confirming a deletion, so it means one
 * thing wherever it appears.
 * @experimental
 */
const AlertDialogAction: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogActionProps> &
    RefAttributes<ElementRef<typeof AlertDialogPrimitive.Action>>
> = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Action>,
  AlertDialogActionProps
>(({ className, children, variant = "primary", ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants({ variant }), className)}
    {...props}
  >
    {children}
  </AlertDialogPrimitive.Action>
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

/** @experimental */
export type AlertDialogCancelProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Cancel
>;

/**
 * AlertDialogCancel - The cancel button.
 * Styled as outline variant.
 * @experimental
 */
const AlertDialogCancel: ForwardRefExoticComponent<
  PropsWithoutRef<AlertDialogCancelProps> &
    RefAttributes<ElementRef<typeof AlertDialogPrimitive.Cancel>>
> = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Cancel>,
  AlertDialogCancelProps
>(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className
    )}
    {...props}
  >
    {children}
  </AlertDialogPrimitive.Cancel>
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
