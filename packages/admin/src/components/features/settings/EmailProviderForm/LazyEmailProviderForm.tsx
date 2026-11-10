"use client";

/**
 * The provider form, with its code fetched apart from the page that draws it.
 *
 * The form and the schema it generates are most of what the provider screens
 * weigh, and a page deciding which step to show, or still fetching the
 * provider, has no use for them yet. A page calls `preloadEmailProviderForm`
 * as it loads, so the fetch runs beside the page's own data rather than after
 * it; the skeleton is the one the edit page's loading state already draws, and
 * a failed fetch is said in its place with a way to try again.
 *
 * @module components/features/settings/EmailProviderForm/LazyEmailProviderForm
 */

import { Skeleton } from "@nextlyhq/ui";
import type { JSX } from "react";

import { ModuleLoadFailure } from "@admin/components/shared/module-load-failure";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";

import type { EmailProviderFormProps } from "./EmailProviderForm";

const providerFormModule = retryableModule(() =>
  import("./EmailProviderForm").then(m => m.EmailProviderForm)
);

/** Starts the form's fetch ahead of its use; a failure is shown by the use. */
export function preloadEmailProviderForm(): void {
  providerFormModule.preload();
}

export function LazyEmailProviderForm(
  props: EmailProviderFormProps
): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    providerFormModule,
    "The email provider form's code"
  );
  if (state.status === "ok") {
    const EmailProviderForm = state.value;
    return <EmailProviderForm {...props} />;
  }
  if (state.status === "error") {
    return (
      <ModuleLoadFailure
        message="The provider form could not be loaded."
        exhausted={attempt > 0}
        onRetry={retry}
      />
    );
  }
  return <Skeleton className="h-[500px] w-full rounded-lg" />;
}
