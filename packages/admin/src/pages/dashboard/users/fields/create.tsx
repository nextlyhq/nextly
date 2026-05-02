"use client";

import { useCallback } from "react";

import {
  UserFieldForm,
  formValuesToCreatePayload,
  type UserFieldFormValues,
} from "@admin/components/features/settings/UserFieldForm";
import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateUserField } from "@admin/hooks/queries/useUserFields";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";

export default function CreateUserFieldPage() {
  const { mutate: createField, isPending } = useCreateUserField();

  const handleSubmit = useCallback(
    (values: UserFieldFormValues) => {
      const payload = formValuesToCreatePayload(values);

      createField(payload, {
        onSuccess: () => {
          toast.success("Field created", {
            description: `${values.label} has been created successfully.`,
          });
          navigateTo(ROUTES.USERS_FIELDS);
        },
        onError: (error: Error) => {
          toast.error("Failed to create field", {
            description: getErrorMessage(
              error,
              "An error occurred while creating the user field."
            ),
          });
        },
      });
    },
    [createField]
  );

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div>
          <div className="mb-6">
            <UserBreadcrumbs currentPage="fields-create" />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Create Field</h1>
              <p className="text-sm font-normal text-primary/50 mt-1">
                Add a new custom attribute to user accounts
              </p>
            </div>
          </div>

          <UserFieldForm
            mode="create"
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        </div>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
