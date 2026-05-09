import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, type LucideProps } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";

/**
 * Spinner Component - Design System Specification
 *
 * Loading indicator for short wait times (300ms - 1s). Uses the Loader2 icon from
 * lucide-react with a smooth rotation animation.
 *
 * **Usage Guidelines** (from UX Strategy):
 * - ✅ Use for buttons and small components (loading states)
 * - ✅ Use for short waits (300ms - 1s)
 * - ❌ Don't use for page content (use Skeleton instead)
 * - ❌ Don't use for waits > 3s (use Progress bar instead)
 *
 * **Sizes**:
 * - sm: 16px (h-4 w-4) - For small buttons, inline text
 * - md: 20px (h-5 w-5) - Default size, for regular buttons
 * - lg: 24px (h-6 w-6) - For large buttons, prominent loading states
 *
 * **Accessibility**:
 * - Uses `role="status"` for screen reader announcements
 * - Uses `aria-label="Loading"` for accessible name
 * - Respects `prefers-reduced-motion` (animation stops automatically via Tailwind)
 * - Non-focusable (not interactive)
 *
 * **Animation**:
 * - Uses Tailwind's `animate-spin` utility (1s linear infinite)
 * - Automatically respects user's motion preferences (WCAG 2.3.3)
 *
 * @example
 * // Button loading state
 * <Button disabled>
 *   <Spinner size="sm" className="mr-2" />
 *   Saving...
 * </Button>
 *
 * @example
 * // Standalone loading indicator
 * <div className="flex items-center justify-center p-8">
 *   <Spinner size="lg" />
 * </div>
 *
 * @example
 * // Custom color
 * <Spinner className="text-primary" />
 */
const spinnerVariants = cva("animate-spin motion-reduce:animate-none", {
  variants: {
    size: {
      sm: "h-4 w-4",
      md: "h-5 w-5",
      lg: "h-6 w-6",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

/**
 * Spinner component props
 *
 * Extends LucideProps to support all standard SVG attributes (data-*, id, etc.)
 * while providing size variants and accessibility features.
 */
export type SpinnerProps = Omit<LucideProps, "size"> &
  VariantProps<typeof spinnerVariants> & {
    /**
     * Accessible label for screen readers
     * @default "Loading"
     */
    "aria-label"?: string;
  };

/**
 * Spinner component for loading states
 */
const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(
  (
    { size = "md", className, "aria-label": ariaLabel = "Loading", ...props },
    ref
  ) => {
    return (
      <Loader2
        ref={ref}
        role="status"
        aria-label={ariaLabel}
        className={cn(spinnerVariants({ size }), className)}
        {...props}
      />
    );
  }
);

Spinner.displayName = "Spinner";

export { Spinner, spinnerVariants };
