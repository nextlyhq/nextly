"use client";

import { QueryErrorResetBoundary } from "@tanstack/react-query";
import React, { type ReactNode } from "react";

import { ErrorBoundary } from "@admin/components/shared/error-boundary";

/**
 * QueryErrorBoundary Component Props
 */
export interface QueryErrorBoundaryProps {
  /**
   * The child components to wrap with error boundary
   */
  children: ReactNode;

  /**
   * Custom fallback UI to display when an error is caught
   *
   * Must be a React element, not a function. The fallback component
   * will not receive error or reset props automatically.
   *
   * For access to error and reset function, use ErrorBoundary directly
   * with QueryErrorResetBoundary.
   *
   * @example
   * ```tsx
   * <QueryErrorBoundary fallback={<PageErrorFallback />}>
   *   <YourComponent />
   * </QueryErrorBoundary>
   * ```
   */
  fallback?: ReactNode;

  /**
   * Optional error handler callback
   * Called when an error is caught
   *
   * @param error - The caught error
   * @param errorInfo - React error info with component stack
   */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * Query Error Boundary Component
 *
 * Combines React Error Boundary with TanStack Query's QueryErrorResetBoundary
 * to provide comprehensive error handling for both React errors and async query errors.
 *
 * ## Features
 *
 * - Catches React rendering errors via ErrorBoundary
 * - Integrates with TanStack Query error throwing (throwOnError option)
 * - Provides `reset()` function to retry failed queries
 * - Supports custom fallback UI (static or dynamic)
 * - Automatic error recovery on navigation
 * - Optional error logging callback
 *
 * ## How It Works
 *
 * 1. **QueryErrorResetBoundary** wraps the ErrorBoundary and tracks query errors
 * 2. **ErrorBoundary** catches errors thrown by child components
 * 3. When TanStack Query throws an error (via `throwOnError: true`), ErrorBoundary catches it
 * 4. The `reset()` function clears both the error boundary state AND resets failed queries
 * 5. This allows users to retry failed operations with a single button click
 *
 * ## Usage
 *
 * ```tsx
 * import { QueryErrorBoundary, PageErrorFallback } from '@nextly/admin';
 *
 * // Basic usage with static fallback
 * function MyPage() {
 *   return (
 *     <QueryErrorBoundary fallback={<PageErrorFallback />}>
 *       <PageContent />
 *     </QueryErrorBoundary>
 *   );
 * }
 *
 * // With dynamic fallback (receives error and reset function)
 * function MyPage() {
 *   return (
 *     <QueryErrorBoundary
 *       fallback={({ error, reset }) => (
 *         <PageErrorFallback error={error} reset={reset} />
 *       )}
 *     >
 *       <PageContent />
 *     </QueryErrorBoundary>
 *   );
 * }
 *
 * // With error logging
 * function MyPage() {
 *   return (
 *     <QueryErrorBoundary
 *       fallback={<PageErrorFallback />}
 *       onError={(error, errorInfo) => {
 *         // Log to error tracking service
 *         logErrorToService({ error, errorInfo });
 *       }}
 *     >
 *       <PageContent />
 *     </QueryErrorBoundary>
 *   );
 * }
 * ```
 *
 * ## TanStack Query Integration
 *
 * To enable query error throwing, configure your queries with `throwOnError`:
 *
 * ```tsx
 * // Global configuration
 * const queryClient = new QueryClient({
 *   defaultOptions: {
 *     mutations: {
 *       throwOnError: true, // Mutations throw errors to error boundary
 *     },
 *   },
 * });
 *
 * // Per-query configuration
 * const { data } = useQuery({
 *   queryKey: ['users'],
 *   queryFn: fetchUsers,
 *   throwOnError: true, // This query throws errors to error boundary
 * });
 * ```
 *
 * ## Error Recovery Flow
 *
 * 1. User encounters an error (query fails, component throws)
 * 2. QueryErrorBoundary catches error and displays fallback UI
 * 3. User clicks "Try Again" button (which calls `reset()`)
 * 4. QueryErrorResetBoundary resets all failed queries within the boundary
 * 5. ErrorBoundary clears error state
 * 6. Component tree re-renders and retries the operation
 *
 * ## Best Practices
 *
 * - Use at **page level** for best user experience (prevents entire page crash)
 * - Provide meaningful fallback UI with recovery options
 * - Use `PageErrorFallback` for full pages, `SectionErrorFallback` for sections
 * - Enable `throwOnError` for mutations (which should fail fast)
 * - Consider NOT enabling `throwOnError` for background queries (which can retry silently)
 *
 * @see ErrorBoundary - The underlying React error boundary
 * @see PageErrorFallback - Full-page error UI component
 * @see SectionErrorFallback - Section-level error UI component
 * @see QueryErrorResetBoundary - TanStack Query's error reset boundary
 */
export function QueryErrorBoundary({
  children,
  fallback,
  onError,
}: QueryErrorBoundaryProps): React.ReactElement {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <ErrorBoundary fallback={fallback} onError={onError}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
