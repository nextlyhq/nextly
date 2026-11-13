"use client";

/**
 * The Builder's preview of the entry form, with its code fetched when the
 * preview is first turned on rather than bundled with the Builder.
 *
 * The preview draws the entry form itself, every field's editor included,
 * which is more code than the rest of the Builder page. The page opens on the
 * outline with the preview off, so most visits never draw it. A failed fetch
 * is said in the preview's place with a way to try again.
 *
 * @module components/features/schema-builder/outline/LazyFormPreview
 */

import { Skeleton } from "@nextlyhq/ui";
import type { ComponentProps, JSX } from "react";

import { ModuleLoadFailure } from "@admin/components/shared/module-load-failure";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";

import type { FormPreview as FormPreviewComponent } from "./FormPreview";

const formPreviewModule = retryableModule(() =>
  import("./FormPreview").then(m => m.FormPreview)
);

export function LazyFormPreview(
  props: ComponentProps<typeof FormPreviewComponent>
): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    formPreviewModule,
    "The Builder preview's code"
  );
  if (state.status === "ok") {
    const FormPreview = state.value;
    return <FormPreview {...props} />;
  }
  if (state.status === "error") {
    return (
      <ModuleLoadFailure
        message="The preview could not be loaded."
        exhausted={attempt > 0}
        onRetry={retry}
      />
    );
  }
  return <Skeleton className="h-64 w-full rounded-lg" />;
}
