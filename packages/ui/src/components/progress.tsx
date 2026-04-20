/**
 * Progress Component
 *
 * A horizontal progress bar component with variant support for different states.
 * Used to display upload progress, task completion, or any percentage-based metric.
 *
 * ## Design Specifications
 *
 * - **Height**: 8px (h-2)
 * - **Border Radius**: Fully rounded (rounded-full)
 * - **Animation**: Width transition (300ms linear) for smooth progress updates
 * - **Variants**:
 *   - `default`: Primary blue (bg-primary-500)
 *   - `success`: Green (bg-green-500)
 *   - `error`: Red (bg-destructive)
 *
 * ## Accessibility
 *
 * - Uses `role="progressbar"` for screen readers
 * - Includes `aria-valuenow`, `aria-valuemin`, `aria-valuemax` attributes
 * - Includes `aria-label` for context (e.g., "Upload progress: 45%")
 *
 * ## Usage Examples
 *
 * ### Basic usage
 * ```tsx
 * <Progress value={45} />
 * ```
 *
 * ### Success state
 * ```tsx
 * <Progress value={100} variant="success" />
 * ```
 *
 * ### Error state
 * ```tsx
 * <Progress value={30} variant="error" />
 * ```
 *
 * ### With custom label
 * ```tsx
 * <Progress
 *   value={progress}
 *   aria-label={`Uploading ${filename}: ${progress}%`}
 * />
 * ```
 *
 * @see ui-revamp/media-library-design-spec.md - Progress component specification
 */

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Progress variants using CVA
 *
 * Defines color variants for different progress states.
 */
export const progressVariants = cva("h-full rounded-none transition-all", {
  variants: {
    variant: {
      default: "bg-primary-500",
      success: "bg-green-500",
      error: "bg-destructive",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

/**
 * Progress component props
 */
export type ProgressProps = {
  /**
   * Current progress value (0-100)
   *
   * @example
   * ```tsx
   * <Progress value={45} /> // 45% progress
   * ```
   */
  value: number;

  /**
   * Maximum value (default: 100)
   *
   * @example
   * ```tsx
   * <Progress value={30} max={50} /> // 60% progress (30/50)
   * ```
   */
  max?: number;

  /**
   * Visual variant for different states
   *
   * - `default`: Primary blue (bg-primary-500)
   * - `success`: Green (bg-green-500)
   * - `error`: Red (bg-destructive)
   *
   * @default "default"
   */
  variant?: VariantProps<typeof progressVariants>["variant"];

  /**
   * Optional CSS class name for custom styling
   */
  className?: string;

  /**
   * Optional ARIA label for screen readers
   *
   * If not provided, defaults to "Progress: X%"
   *
   * @example
   * ```tsx
   * <Progress value={45} aria-label="Uploading image.jpg: 45%" />
   * ```
   */
  "aria-label"?: string;
} & React.HTMLAttributes<HTMLDivElement>;

/**
 * Progress component
 *
 * Displays a horizontal progress bar with smooth animations and variant support.
 *
 * @param props - Progress component props
 * @returns Progress bar component
 *
 * @example
 * ```tsx
 * function FileUpload() {
 *   const [progress, setProgress] = React.useState(0);
 *
 *   return (
 *     <div>
 *       <p>Uploading file...</p>
 *       <Progress value={progress} aria-label={`Upload progress: ${progress}%`} />
 *     </div>
 *   );
 * }
 * ```
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      value,
      max = 100,
      variant = "default",
      className,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    // Clamp value between 0 and max
    const clampedValue = Math.min(Math.max(0, value), max);
    const percentage = (clampedValue / max) * 100;

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel || `Progress: ${Math.round(percentage)}%`}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-none bg-accent",
          className
        )}
        {...props}
      >
        <div
          className={cn(progressVariants({ variant }))}
          style={{
            width: `${percentage}%`,
            transition: "width 300ms linear",
          }}
        />
      </div>
    );
  }
);

Progress.displayName = "Progress";

export { Progress };
