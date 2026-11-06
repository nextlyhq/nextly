"use client";

/**
 * The upload tray, with its code loaded apart from the media library's.
 *
 * The library and the upload drop area are reached from the admin's entry, so
 * what they import statically loads before the first screen of every route.
 * The tray has nothing to show until files are chosen or dropped, so it comes
 * in its own chunk, asked for as the library or drop area mounts. Its live
 * region does not wait for that chunk: it is drawn here, outside the boundary,
 * so it is mounted before any upload can start, however slowly the tray's code
 * arrives, and it stays the same element once the tray is drawn.
 *
 * @module components/features/media-library/UploadTray/LazyUploadTray
 */

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";
import { cn } from "@admin/lib/utils";

import { UploadLiveRegion } from "./UploadLiveRegion";

import type { UploadTrayProps } from ".";

/**
 * The tray's code. Not `React.lazy`, which keeps a failed fetch and rethrows
 * it into the page's error boundary on every render: a failure here is
 * forgotten, so Try again fetches afresh and the library stays up meanwhile.
 */
const trayModule = retryableModule(() => import(".").then(m => m.UploadTray));

/**
 * Said in the tray's place when its code could not be fetched while files are
 * moving. The uploads themselves carry on (the queue is not in that chunk),
 * and the live region still announces them; only their list is missing.
 */
function UploadTrayLoadError({
  placement,
  className,
  exhausted,
  onRetry,
}: Pick<UploadTrayProps, "placement" | "className"> & {
  exhausted: boolean;
  onRetry: () => void;
}): JSX.Element {
  return (
    <section
      aria-label="Uploads"
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-3 text-foreground",
        placement === "floating" &&
          "fixed bottom-4 right-4 z-40 w-[21.25rem] max-w-[calc(100vw-2rem)] shadow-lg",
        className
      )}
    >
      <p role="alert" className="text-sm text-muted-foreground">
        {exhausted
          ? "The upload list still could not be loaded. Your files keep uploading; reload to see them."
          : "The upload list could not be loaded. Your files keep uploading."}
      </p>
      {exhausted ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload the page
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </section>
  );
}

/**
 * The uploads' live region at once, and {@link UploadTray} once its code has
 * arrived; nothing visible before that, and if the code could not be fetched
 * while files are moving, a short note with a way to try again.
 */
export function LazyUploadTray(props: UploadTrayProps): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    trayModule,
    "The upload tray's code"
  );
  let tray: JSX.Element | null = null;
  if (state.status === "ok") {
    const UploadTray = state.value;
    tray = <UploadTray {...props} />;
  } else if (state.status === "error" && props.queue.rows.length > 0) {
    // With nothing uploading there is nothing to show yet; the next upload
    // still finds the note, and Try again fetches afresh.
    tray = (
      <UploadTrayLoadError
        placement={props.placement}
        {...(props.className === undefined
          ? {}
          : { className: props.className })}
        exhausted={attempt > 0}
        onRetry={retry}
      />
    );
  }
  return (
    <>
      <UploadLiveRegion queue={props.queue} />
      {tray}
    </>
  );
}
