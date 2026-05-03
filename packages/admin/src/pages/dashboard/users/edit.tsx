"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  Button,
  Skeleton,
  Spinner,
} from "@revnixhq/ui";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import {
  useForm,
  FormProvider,
  type Control,
  type FieldValues,
} from "react-hook-form";

import { AvatarUploader } from "@admin/components/features/user-management/avatar-uploader";
import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import { UserFormFields } from "@admin/components/features/user-management/form-fields";
import { UserCustomFields } from "@admin/components/features/users/UserCustomFields";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { FORM_MIN_HEIGHT } from "@admin/constants/forms";
import { USER_MESSAGES } from "@admin/constants/messages";
import { ROUTES } from "@admin/constants/routes";
import { useRoles } from "@admin/hooks/queries/useRoles";
import { useUserFields } from "@admin/hooks/queries/useUserFields";
import { useUser, useUpdateUser } from "@admin/hooks/queries/useUsers";
import { useRouter } from "@admin/hooks/useRouter";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { filterStringArray } from "@admin/lib/type-guards";
import { validateUUID } from "@admin/lib/validation";
import {
  editUserFormSchema,
  type EditUserFormValues,
} from "@admin/types/userform";

/**
 * EditUserPage Component
 *
 * Full-page form for editing existing users with TanStack Query integration.
 * Uses new design system components for consistent UI/UX.
 *
 * ## Features
 * - TanStack Query integration (useUser + useUpdateUser)
 * - Optimistic updates for instant UI feedback
 * - Automatic cache invalidation on success
 * - Loading states (Skeleton during fetch, Spinner during submit)
 * - Error states (Alert for fetch errors, toast for submit errors)
 * - Form validation with react-hook-form + zod
 * - Responsive layout (2-column on desktop, stacked on mobile)
 * - Breadcrumb navigation for context
 * - Avatar preview with fallback
 * - Dark mode support
 *
 * ## UX Improvements
 * - PageContainer for consistent spacing
 * - Inline validation (prevent errors before submit)
 * - Success toast + auto-navigation on success
 * - Password field optional (only for password reset)
 * - Pre-populated form with existing user data
 *
 * ## Future Enhancements (Ready for)
 * - Tabs (Profile, Permissions, Activity, Audit Logs)
 * - Related data sections (user's content, sessions)
 * - Inline actions (Reset Password, Send Email, Deactivate)
 * - Advanced permission matrix
 *
 * @example
 * ```tsx
 * // Accessed via: /admin/dashboard/users/edit/[id]
 * <EditUserPage />
 * ```
 */
export default function EditUserPage(): ReactElement {
  const { route } = useRouter();

  // Validate and extract userId from route params
  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;

  // Validate UUID format using shared utility
  const userId = validateUUID(rawId);

  // TanStack Query: Fetch user data
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
  } = useUser(userId || undefined);

  // TanStack Query: Fetch roles list
  const {
    data: rolesData,
    isLoading: isLoadingRoles,
    error: rolesError,
    refetch: refetchRoles,
  } = useRoles();

  // TanStack Query: Fetch user field definitions (for pre-populating custom fields)
  const { data: fieldsData } = useUserFields();

  // TanStack Query: Update user mutation
  const { mutate: updateUser, isPending: isUpdating } = useUpdateUser();

  // React Hook Form
  const form = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      avatarUrl: "",
      roles: [],
    },
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = form;

  const watchedFullName = watch("fullName");
  const watchedAvatar = watch("avatarUrl");

  // Populate form when user data loads (only if form hasn't been modified)
  // Using isDirty ensures background refetches can update the form if the user hasn't made changes yet
  useEffect(() => {
    if (user && !isDirty) {
      // Build custom field values from user data using field definitions
      const customFields: Record<string, unknown> = {};
      if (fieldsData?.fields) {
        const userRecord = user as unknown as Record<string, unknown>;
        for (const def of fieldsData.fields) {
          if (def.isActive && def.name in userRecord) {
            customFields[def.name] = userRecord[def.name];
          }
        }
      }

      reset({
        fullName: user.name || "",
        email: user.email || "",
        password: "", // Always empty (only for password reset)
        avatarUrl: user.image || "",
        active: user.isActive ?? true,
        roles: user.roles || [],
        customFields,
      });
    }
  }, [user, fieldsData, reset, isDirty]);

  // Use refs to avoid re-registering beforeunload listener on every form field change
  const isDirtyRef = useRef(isDirty);
  const isUpdatingRef = useRef(isUpdating);

  // Keep refs in sync with state
  useEffect(() => {
    isDirtyRef.current = isDirty;
    isUpdatingRef.current = isUpdating;
  }, [isDirty, isUpdating]);

  // Warn user before navigating away with unsaved changes
  // Only register the listener once to avoid memory leaks
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current && !isUpdatingRef.current) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but still show a generic warning
        return (e.returnValue = USER_MESSAGES.UNSAVED_CHANGES_WARNING);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []); // Empty dependency array - only register once

  // Handle form submission
  function onSubmit(values: EditUserFormValues) {
    if (!userId) {
      toast.error("Error", {
        description: USER_MESSAGES.MISSING_USER_ID,
      });
      return;
    }

    // Type-safe roles handling (validated by Zod schema)
    const roles = filterStringArray(values.roles);

    /**
     * Security Note: Password Handling
     *
     * The password is transmitted as plain text to the backend API, but this is acceptable
     * under the following conditions (which MUST be verified in production):
     *
     * 1. ⚠️ HTTPS/TLS: All API requests MUST use HTTPS to encrypt data in transit
     * 2. ⚠️ Backend Hashing: The backend MUST hash passwords using bcrypt/argon2 before storage
     * 3. ⚠️ Never Store Plain Text: Passwords are NEVER stored in plain text in the database
     * 4. ⚠️ Rate Limiting: The user update endpoint should have rate limiting to prevent abuse
     * 5. ✅ Strong Validation: Password requirements enforced by Zod schema (8+ chars, complexity)
     * 6. ✅ Optional Update: Password only sent if user explicitly provides a new one
     *
     * ⚠️ IMPORTANT: Items 1-4 require verification through backend code review or testing.
     *
     * @see packages/nextly/src/services/users/user-service.ts for backend password hashing implementation
     */
    // Extract custom fields from the customFields namespace and flatten to top-level
    const customFields = (values as Record<string, unknown>).customFields as
      | Record<string, unknown>
      | undefined;

    updateUser(
      {
        userId,
        updates: {
          name: values.fullName,
          email: values.email,
          // Only send password if user explicitly entered a new one (trimmed to handle whitespace-only input)
          password: values.password?.trim() || undefined,
          roles, // filterStringArray always returns string[], no fallback needed
          image: values.avatarUrl,
          isActive: values.active,
          ...customFields,
        },
      },
      {
        onSuccess: () => {
          toast.success(USER_MESSAGES.UPDATE_SUCCESS_TITLE, {
            description: USER_MESSAGES.UPDATE_SUCCESS_DESC(values.fullName),
          });
          // Navigate back to users list
          navigateTo(ROUTES.USERS);
        },
        onError: (error: unknown) => {
          toast.error(USER_MESSAGES.UPDATE_ERROR_TITLE, {
            description: getErrorMessage(
              error,
              USER_MESSAGES.UPDATE_ERROR_DESC
            ),
          });
        },
      }
    );
  }

  const roles = rolesData?.data || [];

  // Error state: Invalid user ID
  if (!userId) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>{USER_MESSAGES.INVALID_USER_ID}</AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.USERS}>
            <Button variant="outline">← Back to Users</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Loading state: Fetching user data
  if (isLoadingUser || isLoadingRoles) {
    return (
      <PageContainer>
        {/* Accessibility: Announce loading state to screen readers */}
        <div className="sr-only" role="status" aria-live="polite">
          Loading user data
          {isLoadingUser && isLoadingRoles ? " and roles" : ""}...
        </div>

        {/* Breadcrumbs skeleton */}
        <div className="mb-6">
          <Skeleton className="h-5 w-64" />
        </div>

        {/* Header skeleton */}
        <div className="mb-8">
          <Skeleton className="w-48 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>

        {/* Form skeleton */}
        <Skeleton className={`${FORM_MIN_HEIGHT} w-full rounded-none`} />
      </PageContainer>
    );
  }

  // Error state: Failed to fetch user
  if (userError) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            <span>
              {getErrorMessage(userError, USER_MESSAGES.LOAD_USER_ERROR)}
            </span>
            <Button
              size="md"
              variant="outline"
              onClick={() => {
                void refetchUser();
              }}
              className="ml-2"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.USERS}>
            <Button variant="outline">← Back to Users</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Error state: User not found
  if (!user) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>{USER_MESSAGES.USER_NOT_FOUND}</AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.USERS}>
            <Button variant="outline">← Back to Users</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Breadcrumbs */}
        <div className="mb-6">
          <UserBreadcrumbs currentPage="edit" />
        </div>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Edit User
            </h1>
            <p className="text-sm font-normal text-primary/50 mt-1">
              Update user details, change roles, or reset the password.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={ROUTES.USERS}>
              <Button type="button" variant="outline" disabled={isUpdating}>
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              form="edit-user-form"
              disabled={isUpdating || !!rolesError}
            >
              {isUpdating ? (
                <>
                  <Spinner size="md" className="mr-2" />
                  Saving Changes...
                </>
              ) : rolesError ? (
                "Cannot Save (Roles Failed)"
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-card  border border-primary/5 rounded-none p-6  ">
          {/* Avatar Section */}
          <div className="flex items-center gap-4 mb-8 pb-8  border-b border-primary/5">
            <AvatarUploader
              value={watchedAvatar ?? ""}
              onChange={url =>
                setValue("avatarUrl", url, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              fullName={watchedFullName || user?.name || ""}
              disabled={isUpdating}
              className="border border-primary/5"
              fallbackClassName="bg-primary/5 text-primary dark:bg-primary/20 dark:text-primary-foreground/80"
            />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-foreground">
                {watchedFullName || user.name}
              </h2>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                User ID: {user.id}
              </p>
            </div>
          </div>

          {/* Form */}
          <FormProvider {...form}>
            <form
              id="edit-user-form"
              onSubmit={e => {
                void handleSubmit(onSubmit)(e);
              }}
              className="space-y-8"
            >
              {/* Form Fields */}
              <UserFormFields
                mode="edit"
                register={register}
                control={control}
                errors={errors}
                roles={roles}
                isLoadingRoles={isLoadingRoles}
                rolesError={rolesError}
                onRetryRoles={() => {
                  void refetchRoles();
                }}
                showActiveAccount={true}
              />

              <UserCustomFields
                control={control as unknown as Control<FieldValues>}
                errors={errors}
                disabled={isUpdating}
              />
            </form>
          </FormProvider>
        </div>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
