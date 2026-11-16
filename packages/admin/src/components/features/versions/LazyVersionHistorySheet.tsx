"use client";

/**
 * The document's history panel, with its code fetched as the editor mounts
 * rather than bundled with it.
 *
 * Fetched at once, not on first open: the panel mounts closed so that its
 * window-size answers have settled by the time it opens (it would otherwise
 * mount modal and switch a frame later), and a person who opens History has
 * the code already. Closed, the panel draws nothing, so the editor's first
 * paint is unchanged. A link that opens the panel directly opens it when the
 * code arrives. A failed fetch is said only if the panel was asked for, and
 * the editor stays up either way.
 *
 * @module components/features/versions/LazyVersionHistorySheet
 */

import type { JSX } from "react";

import { ModuleLoadFailure } from "@admin/components/shared/module-load-failure";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";

import type { VersionHistorySheetProps } from "./VersionHistorySheet";

const historySheetModule = retryableModule(() =>
  import("./VersionHistorySheet").then(m => m.VersionHistorySheet)
);

export function LazyVersionHistorySheet(
  props: VersionHistorySheetProps
): JSX.Element | null {
  const { state, attempt, retry } = useRetryableModule(
    historySheetModule,
    "The history panel's code"
  );
  if (state.status === "ok") {
    const VersionHistorySheet = state.value;
    return <VersionHistorySheet {...props} />;
  }
  if (state.status === "error" && props.open) {
    return (
      <div className="px-4 py-2">
        <ModuleLoadFailure
          message="The history panel could not be loaded."
          exhausted={attempt > 0}
          onRetry={retry}
        />
      </div>
    );
  }
  return null;
}
