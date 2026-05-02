"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
import { useCallback } from "react";

import {
  EmailTemplateForm,
  formValuesToUpdatePayload,
  type TemplateFormValues,
} from "@admin/components/features/settings/EmailTemplateForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
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

export default function EditEmailTemplatePage() {
  const { route } = useRouter();

  // Extract and validate template ID from route params
  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const templateId = validateUUID(rawId);

  // Fetch template data
  const {
    data: template,
    isLoading,
    error: fetchError,
    refetch,
  } = useEmailTemplate(templateId || undefined);

  // Update mutation
  const { mutate: updateTemplate, isPending } = useUpdateEmailTemplate();

  const handleSubmit = useCallback(
    (values: TemplateFormValues) => {
      if (!templateId) return;

      const payload = formValuesToUpdatePayload(values);

      updateTemplate(
        { id: templateId, data: payload },
        {
          onSuccess: () => {
            toast.success("Template updated", {
              description: `${values.name} has been updated successfully.`,
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

  // Invalid ID
  if (!templateId) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Invalid template ID. Please go back and try again.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
              <Button variant="outline">Back to Templates</Button>
            </Link>
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <PageContainer>
        <SettingsLayout>
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-9 w-9 rounded-none" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-[500px] w-full rounded-none" />
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>
                {getErrorMessage(
                  fetchError,
                  "Failed to load template details."
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { void refetch(); }}
                className="ml-2"
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
              <Button variant="outline">Back to Templates</Button>
            </Link>
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <EmailTemplateForm
            mode="edit"
            template={template}
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
