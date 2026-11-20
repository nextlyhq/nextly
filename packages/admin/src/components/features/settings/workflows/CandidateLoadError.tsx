"use client";

/**
 * Says a list the settings choose from (the roles, or the people) could not be
 * loaded, with the server's reason and a way to ask again. Shown in place of a
 * choice drawn from it, so a failed read never looks like an empty list.
 */

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import type React from "react";

import { apiErrorMessage } from "@admin/lib/api/parseApiError";

export interface CandidateLoadErrorProps {
  /** What failed to load, as the sentence names it. */
  what: "roles" | "people";
  error: unknown;
  onRetry: () => void;
}

export function CandidateLoadError({
  what,
  error,
  onRetry,
}: CandidateLoadErrorProps): React.JSX.Element {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>
          The {what} could not be loaded:{" "}
          {apiErrorMessage(error, "please try again.")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Retry loading ${what}`}
          onClick={onRetry}
        >
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
