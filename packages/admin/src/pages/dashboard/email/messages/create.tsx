"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";

import {
  DEFAULT_VALUES,
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
import { generateSlug } from "@admin/lib/fields";
import { navigateTo } from "@admin/lib/navigation";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";
import { getTemplate } from "@admin/services/emailTemplateApi";

export default function CreateEmailTemplatePage(): JSX.Element {
  const { mutate: createTemplate, isPending } = useCreateEmailTemplate();
  const [duplicateTemplate, setDuplicateTemplate] =
    useState<EmailTemplateRecord | null>(null);
  const [isLoadingDuplicate, setIsLoadingDuplicate] = useState(false);
  // Which `?duplicate=<id>` we've already attempted. Guards against retrying a
  // failed load forever: without it, `finally` clears the loading flag and the
  // effect's condition is satisfied again, re-requesting on every render.
  const attemptedDuplicateId = useRef<string | null>(null);
  // The name the create dialog asked for, if it opened this page. Read once:
  // the URL doesn't change while the page is mounted.
  const [givenName] = useState(() => {
    const name = new URLSearchParams(window.location.search).get("name");
    return name?.trim() ? name.trim() : null;
  });

  // Support duplicating an existing template via ?duplicate=<id>. One-shot: the
  // URL param doesn't change while this page is mounted.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const duplicateId = params.get("duplicate");
    if (!duplicateId || attemptedDuplicateId.current === duplicateId) return;
    attemptedDuplicateId.current = duplicateId;
    setIsLoadingDuplicate(true);
    getTemplate(duplicateId)
      .then(setDuplicateTemplate)
      .catch(() => {
        toast.error("Failed to load template", {
          description: "Could not load the template to duplicate.",
        });
      })
      .finally(() => setIsLoadingDuplicate(false));
  }, []);

  const initialValues = useMemo(() => {
    if (!duplicateTemplate) {
      if (!givenName) return undefined;
      return {
        ...DEFAULT_VALUES,
        name: givenName,
        slug: generateSlug(givenName),
      };
    }
    const values = templateToFormValues(duplicateTemplate);
    values.name = givenName ?? `${values.name} (Copy)`;
    values.slug = givenName ? generateSlug(givenName) : `${values.slug}-copy`;
    values.isActive = false;
    return values;
  }, [duplicateTemplate, givenName]);

  const handleSubmit = useCallback(
    (values: TemplateFormValues) => {
      createTemplate(formValuesToCreatePayload(values), {
        onSuccess: () => {
          toast.success("Template created", {
            description: `${values.name} has been created.`,
          });
          navigateTo(ROUTES.EMAIL);
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
