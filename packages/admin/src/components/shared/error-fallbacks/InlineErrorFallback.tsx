"use client";

import type React from "react";

import { AlertCircle } from "@admin/components/icons";

/**
 * InlineErrorFallback Component Props
 */
export interface InlineErrorFallbackProps {
  /**
   * The error that was caught by the error boundary
   */
  error?: Error;

  /**
   * Optional custom error message
   * @default "Error loading content"
   */
  message?: string;

  /**
   * Show error icon
   * @default true
   */
  showIcon?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Inline Error Fallback Component
 *
 * Displays a minimal, single-line error message for non-critical errors.
 * Suitable for small components where a full Alert would be too intrusive.
 *
 * ## Features
 *
 * - Minimal footprint (single line with icon)
 * - No action buttons (non-critical errors)
 * - Dark mode support via text-destructive color
 * - Customizable message
 * - Optional icon display
 *
 * ## Usage
 *
 * ```tsx
 * // Basic usage
 * <ErrorBoundary fallback={<InlineErrorFallback />}>
 *   <UserAvatar />
 * </ErrorBoundary>
 *
 * // Custom message
 * <ErrorBoundary fallback={
 *   <InlineErrorFallback message="Unable to load avatar" />
 * }>
 *   <UserAvatar />
 * </ErrorBoundary>
 *
 * // Without icon
 * <ErrorBoundary fallback={
 *   <InlineErrorFallback showIcon={false} />
 * }>
 *   <Badge />
 * </ErrorBoundary>
 * ```
 *
 * ## When to Use
 *
 * Use InlineErrorFallback for:
 * - Small UI components (avatars, badges, icons)
 * - Non-critical content (optional widgets)
 * - List items or table cells
 * - Components where full error UI would be disproportionate
 *
 * Use SectionErrorFallback for:
 * - Tables, forms, and larger components
 * - When "Try Again" action is needed
 *
 * Use PageErrorFallback for:
 * - Entire pages/routes
 * - Critical errors
 *
 * ## Accessibility
 *
 * - Uses semantic text with destructive color
 * - AlertCircle icon provides visual indication
 * - Text is readable and descriptive
 *
 * @see ErrorBoundary - The error boundary component that uses this fallback
 * @see SectionErrorFallback - Section-level error fallback with retry button
 * @see PageErrorFallback - Full-page error fallback for critical errors
 */
export function InlineErrorFallback({
  error,
  message = "Error loading content",
  showIcon = true,
  className = "",
}: InlineErrorFallbackProps): React.ReactElement {
  // In development, show the actual error message if available
  const displayMessage =
    process.env.NODE_ENV === "development" && error
      ? `Error: ${error.message}`
      : message;

  return (
    <div
      className={`flex items-center gap-2 text-sm text-destructive ${className}`}
    >
      {showIcon && <AlertCircle className="h-4 w-4 flex-shrink-0" />}
      <span>{displayMessage}</span>
    </div>
  );
}
