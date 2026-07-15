"use client";

import type { ReactNode } from "react";

import { ErrorBoundary } from "../error-boundary";

interface PluginComponentBoundaryProps {
  /** The component path being rendered (shown in the fallback for diagnosis). */
  componentPath: string;
  children: ReactNode;
  /** Optional custom fallback; defaults to a compact, identifiable message. */
  fallback?: ReactNode;
}

/**
 * Wraps a plugin-contributed admin component in an error boundary.
 *
 * A throwing plugin component is contained to a small, identifiable fallback
 * instead of white-screening the surrounding admin page. Use via `PluginSlot`,
 * which resolves the component and wraps it here.
 */
export function PluginComponentBoundary({
  componentPath,
  children,
  fallback,
}: PluginComponentBoundaryProps): ReactNode {
  return (
    <ErrorBoundary
      fallback={
        fallback ?? (
          <div
            role="alert"
            className="rounded-none border border-destructive-200 bg-destructive-50 p-3 text-sm dark:border-destructive-800 dark:bg-destructive-950"
          >
            <p className="font-medium text-destructive-900 dark:text-destructive-100">
              This plugin component failed to load.
            </p>
            <code className="mt-1 block text-xs text-destructive-700 dark:text-destructive-300">
              {componentPath}
            </code>
          </div>
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}
