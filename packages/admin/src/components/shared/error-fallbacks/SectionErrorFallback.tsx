"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@revnixhq/ui";
import type React from "react";

import { AlertCircle, RefreshCw } from "@admin/components/icons";

/**
 * SectionErrorFallback Component Props
 */
export interface SectionErrorFallbackProps {
  /**
   * The error that was caught by the error boundary
   */
  error?: Error;

  /**
   * Optional reset function to retry the operation
   * Provided by QueryErrorResetBoundary for TanStack Query errors
   */
  reset?: () => void;

  /**
   * Optional title for the error message
   * @default "Error loading section"
   */
  title?: string;

  /**
   * Optional description override
   * @default Generic error message
   */
  description?: string;

  /**
   * Show error details in development
   * @default true
   */
  showDetails?: boolean;
}

/**
 * Section-level Error Fallback Component
 *
 * Displays a compact error UI when an error boundary catches an error
 * within a section of the page (e.g., table, form section, widget).
 * Less intrusive than PageErrorFallback - suitable for partial page failures.
 *
 * ## Features
 *
 * - Compact Alert component design
 * - Error details displayed in development mode only
 * - Optional "Try Again" button when reset function provided (TanStack Query)
 * - Dark mode support via Alert component
 * - Non-blocking (doesn't take over entire page)
 *
 * ## Usage
 *
 * ```tsx
 * // Basic usage with ErrorBoundary
 * <ErrorBoundary fallback={<SectionErrorFallback />}>
 *   <DataTable />
 * </ErrorBoundary>
 *
 * // With QueryErrorBoundary (provides reset function)
 * <QueryErrorBoundary fallback={(props) => <SectionErrorFallback {...props} />}>
 *   <StatsWidget />
 * </QueryErrorBoundary>
 *
 * // Custom error message
 * <ErrorBoundary fallback={
 *   <SectionErrorFallback
 *     title="Failed to load table"
 *     description="Unable to fetch data. Please try again."
 *   />
 * }>
 *   <UserTable />
 * </ErrorBoundary>
 * ```
 *
 * ## When to Use
 *
 * Use SectionErrorFallback for:
 * - Tables and data grids
 * - Dashboard widgets/cards
 * - Form sections
 * - Sidebar components
 * - Any component that's part of a larger page
 *
 * Use PageErrorFallback for:
 * - Entire pages/routes
 * - Critical errors that prevent page rendering
 *
 * ## Accessibility
 *
 * - Uses Alert component with destructive variant
 * - AlertCircle icon provides visual indication
 * - Keyboard accessible "Try Again" button
 *
 * @see ErrorBoundary - The error boundary component that uses this fallback
 * @see QueryErrorBoundary - Enhanced boundary with TanStack Query integration
 * @see PageErrorFallback - Full-page error fallback for critical errors
 */
export function SectionErrorFallback({
  error,
  reset,
  title = "Error loading section",
  description,
  showDetails = true,
}: SectionErrorFallbackProps): React.ReactElement {
  const defaultDescription =
    "An error occurred while loading this section. Please try again.";

  return (
    <Alert variant="destructive" aria-live="assertive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-sm">{description || defaultDescription}</p>

        {/* Error details in development mode */}
        {process.env.NODE_ENV === "development" && showDetails && error && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">
              Error details
            </summary>
            <pre className="mt-2 overflow-auto rounded-none bg-destructive/10 p-2">
              {error.message}
            </pre>
          </details>
        )}

        {/* Try Again button (only if reset function provided) */}
        {reset && (
          <div className="pt-1">
            <Button
              onClick={reset}
              variant="outline"
              size="md"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-3 w-3" />
              Try Again
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
