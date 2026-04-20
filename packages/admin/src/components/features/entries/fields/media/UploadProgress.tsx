/**
 * Upload Progress Component
 *
 * A specialized progress indicator for file uploads that displays
 * both a visual progress bar and percentage text.
 *
 * @module components/entries/fields/media/UploadProgress
 * @since 1.0.0
 */

import { Progress } from "@revnixhq/ui";

import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface UploadProgressProps {
  /**
   * Current progress percentage (0-100).
   */
  progress: number;

  /**
   * Optional filename to display alongside progress.
   */
  filename?: string;

  /**
   * Whether the upload completed successfully.
   * Shows success variant when true.
   * @default false
   */
  isComplete?: boolean;

  /**
   * Whether the upload encountered an error.
   * Shows error variant when true.
   * @default false
   */
  isError?: boolean;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * UploadProgress displays upload progress with a visual bar and percentage.
 *
 * Features:
 * - Visual progress bar with smooth animation
 * - Percentage text display
 * - Success/error state variants
 * - Optional filename display
 * - Accessible with ARIA attributes
 *
 * @example
 * ```tsx
 * // Basic usage
 * <UploadProgress progress={45} />
 *
 * // With filename
 * <UploadProgress progress={75} filename="document.pdf" />
 *
 * // Success state
 * <UploadProgress progress={100} isComplete />
 *
 * // Error state
 * <UploadProgress progress={30} isError />
 * ```
 */
export function UploadProgress({
  progress,
  filename,
  isComplete = false,
  isError = false,
  className,
}: UploadProgressProps) {
  // Determine progress bar variant based on state
  const variant = isError ? "error" : isComplete ? "success" : "default";

  // Clamp progress value to 0-100
  const clampedProgress = Math.min(Math.max(0, progress), 100);

  return (
    <div className={cn("space-y-1", className)}>
      {/* Filename and percentage row */}
      <div className="flex items-center justify-between text-xs">
        {filename && (
          <span className="truncate text-muted-foreground max-w-[200px]">
            {filename}
          </span>
        )}
        <span
          className={cn(
            "tabular-nums font-medium ml-auto",
            isError && "text-destructive",
            isComplete && "text-green-600"
          )}
        >
          {Math.round(clampedProgress)}%
        </span>
      </div>

      {/* Progress bar */}
      <Progress
        value={clampedProgress}
        variant={variant}
        aria-label={
          filename
            ? `Uploading ${filename}: ${clampedProgress}%`
            : `Upload progress: ${clampedProgress}%`
        }
      />
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
