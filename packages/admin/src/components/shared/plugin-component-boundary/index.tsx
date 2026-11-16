"use client";

import type { ReactNode } from "react";

import { ErrorBoundary } from "../error-boundary";

interface PluginComponentBoundaryProps {
  /** The component path being rendered (shown in the fallback for diagnosis). */
  componentPath: string;
  children: ReactNode;
  /** Optional custom fallback; defaults to a compact, identifiable message. */
  fallback?: ReactNode;
  /** Told when the component throws, for a host that draws the failure itself. */
  onError?: () => void;
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
  onError,
}: PluginComponentBoundaryProps): ReactNode {
  return (
    <ErrorBoundary
      {...(onError === undefined ? {} : { onError: () => onError() })}
      fallback={
        fallback ?? (
          <div
            role="alert"
            className="rounded-md border border-danger-border bg-danger-surface p-3 text-sm"
          >
            <p className="font-medium text-danger-text">
              This plugin component failed to load.
            </p>
            <code className="mt-1 block text-xs text-foreground">
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
