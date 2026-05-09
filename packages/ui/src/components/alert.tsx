import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../lib/utils";

/**
 * Alert Component - Design System Specification
 *
 * Alerts display important messages that require user attention or awareness.
 * They are non-interactive callouts used for inline notifications and feedback.
 *
 * Design Specs:
 * - Padding: 16px (p-4)
 * - Border radius: 0px (rounded-none) - intentionally smaller than Card (12px)
 *   for inline/flow content vs. larger container components
 * - Border: 1px solid matching variant color
 * - Shadow: sm (subtle elevation)
 * - Font: 14px (text-sm)
 * - Layout: Flex with gap-3 for icon/content spacing
 * - Colors: Light backgrounds with dark text for WCAG 2.2 AA compliance
 *
 * Variants (4 total):
 * - info (default): Blue - informational messages, neutral announcements
 * - success: Green - successful operations, confirmations
 * - warning: Amber - cautions, warnings that need attention
 * - destructive: Red - errors, critical issues, failures
 *
 * Structure:
 * <Alert variant="info">
 *   <InfoIcon className="h-4 w-4" />
 *   <div>
 *     <AlertTitle>Optional Title</AlertTitle>
 *     <AlertDescription>Alert message content</AlertDescription>
 *   </div>
 * </Alert>
 *
 * Accessibility:
 * - Defaults to role="alert" for assertive screen reader announcements
 * - Override with role="status" for non-urgent updates (polite announcements)
 * - Override with role={undefined} to remove ARIA role if needed
 * - Color is not the only indicator - icons and text convey meaning
 * - Supports rich content (links, lists) within AlertDescription
 * - WCAG 2.2 AA compliant color contrast (4.5:1 minimum)
 *
 * Usage Examples:
 *
 * // Simple alert with icon and description (default role="alert")
 * <Alert variant="success">
 *   <CheckCircle2 className="h-4 w-4" />
 *   <AlertDescription>User created successfully!</AlertDescription>
 * </Alert>
 *
 * // Alert with title and description
 * <Alert variant="warning">
 *   <AlertTriangle className="h-4 w-4" />
 *   <div>
 *     <AlertTitle>Warning</AlertTitle>
 *     <AlertDescription>This action cannot be undone.</AlertDescription>
 *   </div>
 * </Alert>
 *
 * // Non-urgent informational update
 * <Alert variant="info" role="status">
 *   <AlertCircle className="h-4 w-4" />
 *   <AlertDescription>New features are now available.</AlertDescription>
 * </Alert>
 *
 * Icons (from lucide-react):
 * - Info: <AlertCircle className="h-4 w-4" />
 * - Success: <CheckCircle2 className="h-4 w-4" />
 * - Warning: <AlertTriangle className="h-4 w-4" />
 * - Destructive: <XCircle className="h-4 w-4" />
 */
const alertVariants = cva(
  "relative flex items-start gap-3 rounded-none  border border-primary/5 p-4 text-sm   transition-colors duration-150",
  {
    variants: {
      variant: {
        info: "border-primary/5 bg-primary/5 text-primary dark:border-primary/30 dark:bg-primary/5 dark:text-primary-foreground/90",
        success:
          "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100",
        warning:
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
        destructive:
          "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

export type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants>;

/**
 * Alert - Root container for alert messages
 *
 * Defaults to role="alert" for screen reader announcements. Override with
 * role="status" for non-urgent updates or role={undefined} to remove.
 *
 * @example
 * <Alert variant="success">
 *   <CheckCircle2 className="h-4 w-4" />
 *   <AlertDescription>Operation completed successfully</AlertDescription>
 * </Alert>
 */
const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", role = "alert", ...props }, ref) => {
    return (
      <div
        ref={ref}
        role={role}
        data-slot={`alert.${variant}`}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
Alert.displayName = "Alert";

export type AlertTitleProps = HTMLAttributes<HTMLHeadingElement>;

/**
 * AlertTitle - Heading text for alert message
 *
 * Renders as <h5> for semantic HTML structure. Use for brief, scannable
 * alert headings that summarize the message (e.g., "Success", "Warning").
 *
 * @example
 * <AlertTitle>Payment Successful</AlertTitle>
 */
const AlertTitle = forwardRef<HTMLHeadingElement, AlertTitleProps>(
  ({ className, ...props }, ref) => {
    return (
      <h5
        ref={ref}
        data-slot="alert-title"
        className={cn(
          "mb-1 text-sm font-semibold leading-tight tracking-tight",
          className
        )}
        {...props}
      />
    );
  }
);
AlertTitle.displayName = "AlertTitle";

export type AlertDescriptionProps = HTMLAttributes<HTMLDivElement>;

/**
 * AlertDescription - Supporting detail text for alert message
 *
 * Renders as <div> to support rich content (links, lists, formatting).
 * Use for detailed explanations, instructions, or contextual information.
 *
 * @example
 * <AlertDescription>
 *   Your changes have been saved. <a href="/view">View details</a>
 * </AlertDescription>
 */
const AlertDescription = forwardRef<HTMLDivElement, AlertDescriptionProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="alert-description"
        className={cn("text-sm leading-relaxed", className)}
        {...props}
      />
    );
  }
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription, alertVariants };
