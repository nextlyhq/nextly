"use client";

import { PageHeader } from "@nextlyhq/ui";
import { useCallback, type JSX } from "react";

import {
  UserFieldForm,
  formValuesToCreatePayload,
  type UserFieldFormValues,
} from "@admin/components/features/settings/UserFieldForm";
import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import { PermissionGuard } from "@admin/components/guards/PermissionGuard";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateUserField } from "@admin/hooks/queries/useUserFields";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { READ_SETTINGS } from "@admin/lib/permissions/system-policy";
import { UserFieldsGuard } from "./user-fields-guard";

function CreateUserFieldPageContent(): JSX.Element {
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

  // The route asks `create-settings`; the page also asks `read-settings`,
  // which the list it is reached from and returns to asks, so a role that may
  // only create is refused here rather than after its create.
  return (
    <PermissionGuard requiredPermission={READ_SETTINGS}>
      <QueryErrorBoundary fallback={<PageErrorFallback />}>
        <PageContainer type="form">
          <div>
            <div className="mb-6 empty:hidden">
              <UserBreadcrumbs currentPage="fields-create" />
            </div>

            <PageHeader
              title="Create Field"
              description="Add a new custom attribute to user accounts"
            />

            <UserFieldForm
              mode="create"
              isPending={isPending}
              onSubmit={handleSubmit}
            />
          </div>
        </PageContainer>
      </QueryErrorBoundary>
    </PermissionGuard>
  );
}

/** The page, opened only to a reader who may also see users (`UserFieldsGuard`). */
export default function CreateUserFieldPage(): JSX.Element {
  return (
    <UserFieldsGuard>
      <CreateUserFieldPageContent />
    </UserFieldsGuard>
  );
}
