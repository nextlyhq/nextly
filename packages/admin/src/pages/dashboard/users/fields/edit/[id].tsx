"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
import { useCallback } from "react";

import {
  UserFieldForm,
  formValuesToUpdatePayload,
  type UserFieldFormValues,
} from "@admin/components/features/settings/UserFieldForm";
import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useUserField,
  useUpdateUserField,
} from "@admin/hooks/queries/useUserFields";
import { useRouter } from "@admin/hooks/useRouter";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";

export default function EditUserFieldPage() {
  const { route } = useRouter();

  // Extract and validate field ID from route params
  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const fieldId = validateUUID(rawId);

  // Fetch field data
  const {
    data: userField,
    isLoading,
    error: fetchError,
    refetch,
  } = useUserField(fieldId || undefined);

  // Update mutation
  const { mutate: updateField, isPending } = useUpdateUserField();

  const handleSubmit = useCallback(
    (values: UserFieldFormValues) => {
      if (!fieldId) return;

      const payload = formValuesToUpdatePayload(values);

      updateField(
        { id: fieldId, data: payload },
        {
          onSuccess: () => {
            toast.success("Field updated", {
              description: `${values.label} has been updated successfully.`,
            });
            navigateTo(ROUTES.USERS_FIELDS);
          },
          onError: (error: Error) => {
            toast.error("Failed to update field", {
              description: getErrorMessage(
                error,
                "An error occurred while updating the user field."
              ),
            });
          },
        }
      );
    },
    [fieldId, updateField]
  );

  // Invalid ID
  if (!fieldId) {
    return (
      <PageContainer>
        <div className="space-y-8">
          <UserBreadcrumbs currentPage="fields-edit" />
          <Alert variant="destructive">
            <AlertDescription>
              Invalid field ID. Please go back and try again.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.USERS_FIELDS}>
              <Button variant="outline">Back to User Fields</Button>
            </Link>
          </div>
        </div>
      </PageContainer>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <PageContainer>
        <div className="space-y-8">
          <UserBreadcrumbs currentPage="fields-edit" />
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-9 w-9 rounded-md" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-[500px] w-full rounded-xl" />
          </div>
        </div>
      </PageContainer>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <PageContainer>
        <div className="space-y-8">
          <UserBreadcrumbs currentPage="fields-edit" />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Edit User Field
              </h1>
              <p className="mt-2 text-base text-muted-foreground">
                Modify attribute properties for user accounts
              </p>
            </div>
          </div>
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>
                {getErrorMessage(
                  fetchError,
                  "Failed to load user field details."
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
            <Link href={ROUTES.USERS_FIELDS}>
              <Button variant="outline">Back to User Fields</Button>
            </Link>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div className="space-y-8">
          <UserBreadcrumbs currentPage="fields-edit" />

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Edit User Field
              </h1>
              <p className="mt-2 text-base text-muted-foreground">
                Modify attribute properties for user accounts
              </p>
            </div>
          </div>

          <UserFieldForm
            mode="edit"
            userField={userField}
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        </div>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
