"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree and displays
 * a fallback UI instead of crashing the entire application.
 *
 * ## Features
 *
 * - Catches errors during rendering, in lifecycle methods, and in constructors
 * - Displays a fallback UI when an error occurs
 * - Optional error callback for logging or reporting
 * - Automatic error recovery on navigation or prop changes
 *
 * ## Usage
 *
 * ```tsx
 * <ErrorBoundary fallback={<ErrorFallback />}>
 *   <ComponentThatMightError />
 * </ErrorBoundary>
 * ```
 *
 * ## Note
 *
 * Error boundaries do NOT catch errors for:
 * - Event handlers (use try-catch instead)
 * - Asynchronous code (setTimeout, requestAnimationFrame callbacks)
 * - Server-side rendering
 * - Errors thrown in the error boundary itself
 *
 * @see https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console in development
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    // Call optional error handler for logging/reporting
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset error state when children change (e.g., navigation)
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Render custom fallback UI or default error message
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center p-4">
          <div className="rounded-none  border border-border border-destructive-200 bg-destructive-50 p-4 dark:border-destructive-800 dark:bg-destructive-950">
            <h2 className="mb-2 text-lg font-semibold text-destructive-900 dark:text-destructive-100">
              Something went wrong
            </h2>
            <p className="text-sm text-destructive-700 dark:text-destructive-300">
              An error occurred while rendering this component. Please try
              refreshing the page.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-destructive-800 dark:text-destructive-200">
                  Error details
                </summary>
                <pre className="mt-2 overflow-auto rounded-none bg-destructive-100 p-2 text-xs text-destructive-900 dark:bg-destructive-900 dark:text-destructive-100">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
