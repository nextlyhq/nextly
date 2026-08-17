import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../lib/utils";

/**
 * Badge Component - Design System Specification
 *
 * Badges are non-interactive elements used to highlight important information,
 * such as status indicators, counts, or labels. They should not be focusable
 * or interactive.
 *
 * Accessibility:
 * - Badges are non-interactive (no keyboard focus or click handlers)
 * - Color is not the only indicator - text conveys meaning
 * - Use aria-label for icon-only badges to provide context
 * - Provide contextual information in surrounding UI
 *
 * Design Specs:
 * - Height: 22px
 * - Padding: 2px 10px (vertical × horizontal)
 * - Border radius: Full (pill shape)
 * - Font: 12px (text-xs), medium weight (500)
 * - Colors: Light backgrounds with dark text for visibility in both light/dark modes
 *
 * Variants (6 total per design spec):
 * - default: Light gray background
 * - primary: Light blue background
 * - success: Light green background
 * - warning: Light amber background
 * - destructive: Light red background
 * - outline: Transparent background with  border border-border
 * @experimental
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-2.5 py-0.5 h-[22px] text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        // Clear, legible chip in both modes (was bg-primary/5 at ~5% opacity,
        // which was nearly invisible on dark backgrounds).
        default: "bg-muted text-foreground",
        primary: "bg-primary/10 text-primary dark:bg-primary/20",
        success:
          "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-100",
        warning:
          "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-100",
        destructive:
          "bg-destructive-100 text-destructive-700 dark:bg-destructive-900 dark:text-destructive-100",
        /*
         * The border colour is NOT important-marked. The base sets no border
         * colour, so nothing inside this component competes for it — the only
         * thing a mark could win against is the caller's own class. Seven
         * outline badges pass one, including a status pill whose comment gives
         * a 3:1 contrast reason for the colour it asks for, and every one of
         * them was being overridden without any sign that it had been.
         */
        outline:
          "border border-border bg-transparent text-foreground dark:text-muted-foreground dark:border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

/** @public */
export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/** @public */
function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      data-slot={`badge.${variant}`}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
