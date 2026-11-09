"use client";

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { cn } from "@admin/lib/utils";

/**
 * Said in place of something whose code could not be fetched, with the way
 * back: one retry covers a blipped fetch, and past that a reload is what
 * recovers (`useRetryableModule` says why).
 *
 * @module components/shared/module-load-failure
 */
export function ModuleLoadFailure({
  message,
  exhausted,
  onRetry,
  className,
}: {
  /** What could not be loaded, as a sentence the reader can act on. */
  message: string;
  /** Whether a retry has already failed, so only a reload is left to offer. */
  exhausted: boolean;
  onRetry: () => void;
  /** Where it sits in its container, when that is not at the start. */
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn("flex flex-col items-start gap-3", className)}
      role="alert"
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {exhausted ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload the page
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
