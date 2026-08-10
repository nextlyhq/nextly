/**
 * Sheet Component Types
 *
 * TypeScript type definitions for the Sheet component (Dialog variant).
 */

import type * as DialogPrimitive from "@radix-ui/react-dialog";

/**
 * Sheet root component props
 * Extends Radix UI Dialog.Root props
 * @public
 */
export type SheetProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Root
>;

/**
 * Sheet trigger component props
 * Extends Radix UI Dialog.Trigger props
 * @experimental
 */
export type SheetTriggerProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Trigger
>;

/**
 * Sheet close component props
 * Extends Radix UI Dialog.Close props
 * @experimental
 */
export type SheetCloseProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Close
>;

/**
 * Sheet overlay component props
 * Extends Radix UI Dialog.Overlay props
 * @experimental
 */
export type SheetOverlayProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Overlay
>;

/**
 * Sheet content component props
 * Extends Radix UI Dialog.Content props with side variant
 */
export type SheetContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /**
   * Which edge to slide the sheet in from
   * @default "right"
   */
  side?: "left" | "right" | "top" | "bottom";
};

/**
 * Sheet header component props
 * Standard div props
 * @public
 */
export type SheetHeaderProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Sheet footer component props
 * Standard div props
 * @experimental
 */
export type SheetFooterProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Sheet title component props
 * Extends Radix UI Dialog.Title props
 * @public
 */
export type SheetTitleProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Title
>;

/**
 * Sheet description component props
 * Extends Radix UI Dialog.Description props
 * @public
 */
export type SheetDescriptionProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>;

/**
 * Sheet component refs
 * @experimental
 */
export type SheetOverlayRef = React.ElementRef<typeof DialogPrimitive.Overlay>;
/** @experimental */
export type SheetContentRef = React.ElementRef<typeof DialogPrimitive.Content>;
/** @experimental */
export type SheetTitleRef = React.ElementRef<typeof DialogPrimitive.Title>;
/** @experimental */
export type SheetDescriptionRef = React.ElementRef<
  typeof DialogPrimitive.Description
>;
