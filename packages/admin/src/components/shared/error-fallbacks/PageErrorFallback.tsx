"use client";

import { Button } from "@revnixhq/ui";
import type React from "react";

import {
  AlertCircle,
  LayoutDashboard,
  RefreshCw,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

/**
 * PageErrorFallback Component Props
 */
export interface PageErrorFallbackProps {
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
   * @default "Something went wrong"
   */
  title?: string;

  /**
   * Optional description override
   * @default Generic error message based on environment
   */
  description?: string;

  /**
   * Show "Go Home" link
   * @default true
   */
  showHomeLink?: boolean;
}

/**
 * Page-level Error Fallback Component
 *
 * Displays a full-page error UI when an error boundary catches an error.
 * Provides user-friendly error messages and recovery options.
 *
 * ## Features
 *
 * - Full-page centered layout using PageContainer
 * - Error details displayed in development mode only
 * - "Reload Page" button to refresh the browser
 * - Optional "Try Again" button when reset function provided (TanStack Query)
 * - Optional "Go Home" link to navigate to dashboard
 * - Dark mode support via Alert component
 *
 * ## Usage
 *
 * ```tsx
 * // Basic usage with ErrorBoundary
 * <ErrorBoundary fallback={<PageErrorFallback />}>
 *   <YourPage />
 * </ErrorBoundary>
 *
 * // With QueryErrorBoundary (provides reset function)
 * <QueryErrorBoundary fallback={(props) => <PageErrorFallback {...props} />}>
 *   <YourPage />
 * </QueryErrorBoundary>
 *
 * // Custom error message
 * <ErrorBoundary fallback={
 *   <PageErrorFallback
 *     title="Failed to load users"
 *     description="There was a problem loading the user list. Please try again."
 *   />
 * }>
 *   <UsersList />
 * </ErrorBoundary>
 * ```
 *
 * ## Accessibility
 *
 * - Uses Alert component with destructive variant for high visibility
 * - AlertCircle icon provides visual indication
 * - Semantic HTML with proper heading hierarchy
 * - Keyboard accessible buttons and links
 *
 * @see ErrorBoundary - The error boundary component that uses this fallback
 * @see QueryErrorBoundary - Enhanced boundary with TanStack Query integration
 */
export function PageErrorFallback({
  error,
  reset,
  title = "Something went wrong",
  description,
  showHomeLink = true,
}: PageErrorFallbackProps): React.ReactElement {
  const defaultDescription =
    process.env.NODE_ENV === "development"
      ? "An unexpected error occurred while loading this page. Check the console for more details."
      : "An unexpected error occurred while loading this page. Please try reloading or contact support if the problem persists.";

  return (
    <PageContainer>
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="w-full max-w-xl bg-background  border border-primary/5 rounded-none p-8 md:p-12 flex flex-col items-center text-center animate-in fade-in zoom-in duration-500">
          <div className="h-16 w-16 bg-primary/5 rounded-none flex items-center justify-center mb-8">
            <AlertCircle className="h-8 w-8 text-foreground" />
          </div>

          <h1 className="text-fluid-2xl font-bold tracking-[-0.03em] text-foreground leading-tight mb-4">
            {title}
          </h1>

          <p className="text-fluid-lg text-muted-foreground leading-relaxed max-w-md mb-10">
            {description || defaultDescription}
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            {/* Reload Page button */}
            <Button
              onClick={() => window.location.reload()}
              variant="default"
              size="md"
              className="w-full sm:w-auto min-w-[140px] px-8 py-6 rounded-none text-sm font-semibold active:scale-95 transition-all duration-200"
            >
              <RefreshCw className="h-4 w-4" />
              Reload page
            </Button>

            {/* Try Again button (only if reset function provided) */}
            {reset && (
              <Button
                onClick={reset}
                variant="outline"
                size="md"
                className="w-full sm:w-auto min-w-[140px] px-8 py-6 rounded-none text-sm font-semibold border-primary/5 hover:bg-accent active:scale-95 transition-all duration-200"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            )}

            {/* Go Home link */}
            {showHomeLink && (
              <Link href={ROUTES.DASHBOARD} className="w-full sm:w-auto">
                <Button
                  variant="ghost"
                  size="md"
                  className="w-full sm:w-auto min-w-[140px] px-8 py-6 rounded-none text-sm font-semibold text-muted-foreground hover:text-foreground active:scale-95 transition-all duration-200"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Go home
                </Button>
              </Link>
            )}
          </div>

          {/* Error details in development mode */}
          {process.env.NODE_ENV === "development" && error && (
            <div className="mt-12 w-full text-left">
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center justify-center gap-2 outline-none">
                  <span>View technical details</span>
                </summary>
                <div className="mt-4 p-4 rounded-none bg-accent/50  border border-primary/5 overflow-hidden">
                  <pre className="text-[11px] font-mono text-muted-foreground/80 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[200px] custom-scrollbar">
                    {error.message}
                    {error.stack && (
                      <span className="opacity-50 block mt-2 pt-2  border-t border-primary/5">
                        {error.stack}
                      </span>
                    )}
                  </pre>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
