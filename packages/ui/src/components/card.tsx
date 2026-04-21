import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, HTMLAttributes } from "react";

import { cn } from "../lib/utils";

/**
 * Card Component - Design System Specification
 *
 * A container component for grouping related content with clear visual separation.
 * Cards provide a structured layout with header, content, and footer sections.
 *
 * Design Specs:
 * - Border radius: 0px (rounded-none)
 * - Padding: 24px (p-6) for header/content, 16px 24px for footer
 * - Shadow: sm (default), md (hover/elevated)
 * - Border: 1px solid border color
 *
 * Variants:
 * - default: Standard card with subtle shadow
 * - interactive: Hover effects for clickable cards (border highlight, shadow increase)
 *   ⚠️ IMPORTANT: When using the interactive variant, you MUST add appropriate
 *   accessibility attributes:
 *   - Add role="button" or use an actual <button> wrapper
 *   - Add tabIndex={0} to make it keyboard accessible
 *   - Add onClick handler for mouse/touch interaction
 *   - Add onKeyDown handler to support Enter/Space keys
 *   - Add aria-label or aria-labelledby to describe the action
 *   Example:
 *   <Card
 *     variant="interactive"
 *     role="button"
 *     tabIndex={0}
 *     onClick={handleClick}
 *     onKeyDown={(e) => e.key === 'Enter' && handleClick()}
 *     aria-label="View user details"
 *   >
 * - elevated: More prominent shadow for emphasis
 *
 * Structure:
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *     <CardDescription>Description</CardDescription>
 *     <CardAction>Action buttons</CardAction>
 *   </CardHeader>
 *   <CardContent>Main content</CardContent>
 *   <CardFooter>Footer actions</CardFooter>
 * </Card>
 *
 * Accessibility:
 * - Semantic HTML structure supports screen readers
 * - Interactive cards MUST have role, tabIndex, and keyboard handlers (see above)
 * - Ensure sufficient color contrast for all text (WCAG 2.2 AA minimum)
 * - Use aria-label or aria-labelledby for cards without visible text labels
 */
const cardVariants = cva(
  "bg-card text-foreground rounded-none border border-border   transition-all duration-200",
  {
    variants: {
      variant: {
        default: "",
        interactive: "cursor-pointer hover:border-primary active:scale-[0.99]",
        elevated: "shadow-md",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export type CardProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants>;

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot={`card.${variant || "default"}`}
        className={cn(cardVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Whether to hide the bottom border separator between header and content.
   * Default: false (border is shown per design spec)
   */
  noBorder?: boolean;
}

const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, noBorder = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="card-header"
        className={cn(
          "flex flex-col p-4",
          !noBorder && "border-b border-border",
          className
        )}
        {...props}
      />
    );
  }
);
CardHeader.displayName = "CardHeader";

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>;

const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, ...props }, ref) => {
    return (
      <h3
        ref={ref}
        data-slot="card-title"
        className={cn("text-xl font-semibold leading-none", className)}
        {...props}
      />
    );
  }
);
CardTitle.displayName = "CardTitle";

export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => {
    return (
      <p
        ref={ref}
        data-slot="card-description"
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
      />
    );
  }
);
CardDescription.displayName = "CardDescription";

export type CardActionProps = HTMLAttributes<HTMLDivElement>;

const CardAction = forwardRef<HTMLDivElement, CardActionProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="card-action"
        className={cn("flex items-center justify-end", className)}
        {...props}
      />
    );
  }
);
CardAction.displayName = "CardAction";

export type CardContentProps = HTMLAttributes<HTMLDivElement>;

const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="card-content"
        className={cn("p-6", className)}
        {...props}
      />
    );
  }
);
CardContent.displayName = "CardContent";

export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="card-footer"
        className={cn(
          "flex items-center px-6 py-4 border-t border-border bg-muted/50",
          className
        )}
        {...props}
      />
    );
  }
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
};
