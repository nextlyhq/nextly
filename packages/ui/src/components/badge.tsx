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
 * - outline: Transparent background with  border border-primary/5
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-none px-2.5 py-0.5 h-[22px] text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-primary/5 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
        primary:
          "bg-primary/5 text-primary dark:bg-primary/20 dark:text-primary-foreground/90",
        success:
          "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100",
        warning:
          "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100",
        destructive:
          "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100",
        outline:
          "border !border-primary/5 bg-transparent text-slate-700 dark:text-slate-300 dark:!border-primary/5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

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
