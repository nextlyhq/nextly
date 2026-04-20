/**
 * Error Fallback Components
 *
 * Pre-built error fallback UI components for use with React Error Boundaries.
 * Provides specialized fallback UIs for different error contexts.
 *
 * ## Available Components
 *
 * - **PageErrorFallback**: Full-page error UI with reload and navigation options
 * - **SectionErrorFallback**: Compact error UI for component/section errors
 * - **InlineErrorFallback**: Minimal single-line error message
 *
 * ## Usage Example
 *
 * ```tsx
 * import { ErrorBoundary } from '@nextly/admin';
 * import { PageErrorFallback } from '@nextly/admin';
 *
 * function MyPage() {
 *   return (
 *     <ErrorBoundary fallback={<PageErrorFallback />}>
 *       <PageContent />
 *     </ErrorBoundary>
 *   );
 * }
 * ```
 *
 * @module ErrorFallbacks
 */

export { InlineErrorFallback } from "./InlineErrorFallback";
export type { InlineErrorFallbackProps } from "./InlineErrorFallback";

export { PageErrorFallback } from "./PageErrorFallback";
export type { PageErrorFallbackProps } from "./PageErrorFallback";

export { SectionErrorFallback } from "./SectionErrorFallback";
export type { SectionErrorFallbackProps } from "./SectionErrorFallback";
