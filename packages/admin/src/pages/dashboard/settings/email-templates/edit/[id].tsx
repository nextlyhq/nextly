"use client";

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import { useCallback } from "react";

import {
  EmailTemplateForm,
  formValuesToUpdatePayload,
  type TemplateFormValues,
} from "@admin/components/features/settings/EmailTemplateForm";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useEmailTemplate,
  useUpdateEmailTemplate,
} from "@admin/hooks/queries/useEmailTemplates";
import { useRouter } from "@admin/hooks/useRouter";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";

/** Full-bleed centered message used for invalid/error states. */
function EditStateMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
          <Button variant="outline">Back to Templates</Button>
        </Link>
      </div>
    </div>
  );
}

export default function EditEmailTemplatePage() {
  const { route } = useRouter();

  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const templateId = validateUUID(rawId);

  const {
    data: template,
    isLoading,
    error: fetchError,
  } = useEmailTemplate(templateId || undefined);

  const { mutate: updateTemplate, isPending } = useUpdateEmailTemplate();

  const handleSubmit = useCallback(
    (values: TemplateFormValues) => {
      if (!templateId) return;
      updateTemplate(
        { id: templateId, data: formValuesToUpdatePayload(values) },
        {
          onSuccess: () => {
            toast.success("Template updated", {
              description: `${values.name} has been saved.`,
            });
            navigateTo(ROUTES.SETTINGS_EMAIL_TEMPLATES);
          },
          onError: (error: Error) => {
            toast.error("Failed to update template", {
              description: getErrorMessage(
                error,
                "An error occurred while updating the template."
              ),
            });
          },
        }
      );
    },
    [templateId, updateTemplate]
  );

  if (!templateId) {
    return (
      <EditStateMessage message="Invalid template ID. Please go back and try again." />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Loading template…
      </div>
    );
  }

  if (fetchError || !template) {
    return (
      <EditStateMessage
        message={getErrorMessage(
          fetchError,
          "Failed to load template details."
        )}
      />
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <div className="h-full min-h-0">
        <EmailTemplateForm
          mode="edit"
          template={template}
          isPending={isPending}
          onSubmit={handleSubmit}
        />
      </div>
    </QueryErrorBoundary>
  );
}
