"use client";

/**
 * The "send a test" panel, with its code fetched when it is first drawn.
 *
 * Only the last step of adding a provider and the send-a-test dialog draw it,
 * so the provider screens do not carry it to their first paint. A skeleton of
 * the panel's height stands in until the code arrives, and a failed fetch is
 * said in place with a way to try again.
 *
 * @module components/features/email-hub/sending/LazySendTestPanel
 */

import { Skeleton } from "@nextlyhq/ui";
import type { ComponentProps, JSX } from "react";

import { ModuleLoadFailure } from "@admin/components/shared/module-load-failure";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";

import type { SendTestPanel } from "./SendTestPanel";

const sendTestPanelModule = retryableModule(() =>
  import("./SendTestPanel").then(m => m.SendTestPanel)
);

export function LazySendTestPanel(
  props: ComponentProps<typeof SendTestPanel>
): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    sendTestPanelModule,
    "The send-a-test panel's code"
  );
  if (state.status === "ok") {
    const Panel = state.value;
    return <Panel {...props} />;
  }
  if (state.status === "error") {
    return (
      <ModuleLoadFailure
        message="The test panel could not be loaded."
        exhausted={attempt > 0}
        onRetry={retry}
      />
    );
  }
  return <Skeleton className="h-32 w-full" />;
}
