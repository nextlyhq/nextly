"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EmailTemplateForm,
  formValuesToCreatePayload,
  templateToFormValues,
  type TemplateFormValues,
} from "@admin/components/features/settings/EmailTemplateForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateEmailTemplate } from "@admin/hooks/queries/useEmailTemplates";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";
import { getTemplate } from "@admin/services/emailTemplateApi";

export default function CreateEmailTemplatePage() {
  const { mutate: createTemplate, isPending } = useCreateEmailTemplate();
  const [duplicateTemplate, setDuplicateTemplate] =
    useState<EmailTemplateRecord | null>(null);
  const [isLoadingDuplicate, setIsLoadingDuplicate] = useState(false);

  // Check if we're duplicating a template from query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const duplicateId = params.get("duplicate");

    if (duplicateId && !duplicateTemplate && !isLoadingDuplicate) {
      setIsLoadingDuplicate(true);
      getTemplate(duplicateId)
        .then(template => {
          setDuplicateTemplate(template);
        })
        .catch(error => {
          console.error("Failed to load template for duplication:", error);
          toast.error("Failed to load template", {
            description: "Could not load the template to duplicate.",
          });
        })
        .finally(() => {
          setIsLoadingDuplicate(false);
        });
    }
  }, [duplicateTemplate, isLoadingDuplicate]);

  // If duplicating, pre-fill the form with the template data
  const initialValues = useMemo(() => {
    if (!duplicateTemplate) return undefined;

    const values = templateToFormValues(duplicateTemplate);
    // Modify name and slug for the duplicate
    values.name = `${values.name} (Copy)`;
    values.slug = `${values.slug}-copy`;
    values.isActive = false; // Set to inactive by default

    return values;
  }, [duplicateTemplate]);

  const handleSubmit = useCallback(
    (values: TemplateFormValues) => {
      const payload = formValuesToCreatePayload(values);

      createTemplate(payload, {
        onSuccess: () => {
          toast.success("Template created", {
            description: `${values.name} has been created successfully.`,
          });
          navigateTo(ROUTES.SETTINGS_EMAIL_TEMPLATES);
        },
        onError: (error: Error) => {
          toast.error("Failed to create template", {
            description: getErrorMessage(
              error,
              "An error occurred while creating the template."
            ),
          });
        },
      });
    },
    [createTemplate]
  );

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <EmailTemplateForm
            mode="create"
            initialValues={initialValues}
            isPending={isPending || isLoadingDuplicate}
            onSubmit={handleSubmit}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
