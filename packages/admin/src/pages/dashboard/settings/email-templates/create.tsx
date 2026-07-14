"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EmailTemplateForm,
  formValuesToCreatePayload,
  templateToFormValues,
  type TemplateFormValues,
} from "@admin/components/features/settings/EmailTemplateForm";
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

  // Support duplicating an existing template via ?duplicate=<id>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const duplicateId = params.get("duplicate");
    if (duplicateId && !duplicateTemplate && !isLoadingDuplicate) {
      setIsLoadingDuplicate(true);
      getTemplate(duplicateId)
        .then(setDuplicateTemplate)
        .catch(() => {
          toast.error("Failed to load template", {
            description: "Could not load the template to duplicate.",
          });
        })
        .finally(() => setIsLoadingDuplicate(false));
    }
  }, [duplicateTemplate, isLoadingDuplicate]);

  const initialValues = useMemo(() => {
    if (!duplicateTemplate) return undefined;
    const values = templateToFormValues(duplicateTemplate);
    values.name = `${values.name} (Copy)`;
    values.slug = `${values.slug}-copy`;
    values.isActive = false;
    return values;
  }, [duplicateTemplate]);

  const handleSubmit = useCallback(
    (values: TemplateFormValues) => {
      createTemplate(formValuesToCreatePayload(values), {
        onSuccess: () => {
          toast.success("Template created", {
            description: `${values.name} has been created.`,
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
      <div className="h-full min-h-0">
        <EmailTemplateForm
          mode="create"
          initialValues={initialValues}
          isPending={isPending || isLoadingDuplicate}
          onSubmit={handleSubmit}
        />
      </div>
    </QueryErrorBoundary>
  );
}
