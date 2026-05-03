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
import { useEffect } from "react";
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
import { useCreateUser } from "@admin/hooks/queries/useUsers";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { filterStringArray } from "@admin/lib/type-guards";
import {
  createUserFormSchema,
  type CreateUserFormValues,
} from "@admin/types/userform";

/**
 * CreateUserPage Component
 *
 * Full-page form for creating new users with TanStack Query integration.
 * Uses new design system components for consistent UI/UX.
 *
 * ## Features
 * - Full-page form (no modal - better for complex input and future extensibility)
 * - Inline validation with react-hook-form + Zod
 * - TanStack Query mutation with automatic cache invalidation
 * - Success/error toast notifications
 * - Auto-navigation on success
 * - Unsaved changes warning with beforeunload listener
 * - Loading states during submission and roles fetch
 * - Responsive design (2-column grid on desktop, stacked on mobile)
 * - Breadcrumb navigation
 * - Avatar preview with live updates
 *
 * ## Design Specifications
 * - Layout: Full-page with PageContainer
 * - Form grid: 2-column on desktop (md breakpoint), stacked on mobile
 * - Avatar: 2xl size (80px) with fallback
 * - Inputs: 40px height with design system styling
 * - Buttons: 44px height (WCAG 2.2 touch targets)
 * - Spacing: 8px grid (space-y-4, gap-6)
 *
 * ## Accessibility
 * - ARIA labels for all form fields
 * - Error messages announced to screen readers
 * - Keyboard navigation (Tab, Escape)
 * - Required fields marked with aria-required
 *
 * @example
 * ```tsx
 * // Accessed via: /admin/dashboard/users/create
 * <CreateUserPage />
 * ```
 */
export default function CreateUserPage(): ReactElement {
  // TanStack Query: Create user mutation
  const { mutate: createUser, isPending: isCreating } = useCreateUser();

  // TanStack Query: Fetch roles
  const {
    data: rolesData,
    isLoading: isLoadingRoles,
    error: rolesError,
    refetch: refetchRoles,
  } = useRoles();

  // React Hook Form
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      avatarUrl: "",
      active: true,
      sendWelcome: true,
      roles: [],
    },
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = form;

  const watchedFullName = watch("fullName");
  const watchedAvatar = watch("avatarUrl");

  // Warn user before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !isCreating) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but still show a generic warning
        return (e.returnValue = USER_MESSAGES.UNSAVED_CHANGES_WARNING);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, isCreating]);

  // Handle form submission
  function onSubmit(values: CreateUserFormValues) {
    // Type-safe roles handling (validated by Zod schema - minimum 1 role required)
    const roles = filterStringArray(values.roles);

    /**
     * Security Note: Password Handling
     *
     * The password is transmitted as plain text to the backend API, but this is acceptable
     * under the following conditions (which MUST be verified in production):
     *
     * 1. ✅ HTTPS/TLS: All API requests MUST use HTTPS to encrypt data in transit
     * 2. ✅ Backend Hashing: The backend MUST hash passwords using bcrypt/argon2 before storage
     * 3. ✅ Never Store Plain Text: Passwords are NEVER stored in plain text in the database
     * 4. ✅ Rate Limiting: The user creation endpoint should have rate limiting to prevent brute force
     * 5. ✅ Strong Validation: Password requirements enforced by Zod schema (8+ chars, complexity)
     *
     * @see packages/nextly/src/services/users/user-service.ts for backend password hashing implementation
     */
    // Extract custom fields from the customFields namespace and flatten to top-level
    const customFields = (values as Record<string, unknown>).customFields as
      | Record<string, unknown>
      | undefined;

    createUser(
      {
        name: values.fullName,
        email: values.email,
        password: values.password, // Transmitted over HTTPS, hashed by backend
        roles,
        image: values.avatarUrl,
        sendWelcomeEmail: values.sendWelcome,
        ...customFields,
      },
      {
        onSuccess: () => {
          toast.success(USER_MESSAGES.CREATE_SUCCESS_TITLE, {
            description: USER_MESSAGES.CREATE_SUCCESS_DESC(values.fullName),
          });
          // Navigate back to users list
          navigateTo(ROUTES.USERS);
        },
        onError: (error: unknown) => {
          toast.error(USER_MESSAGES.CREATE_ERROR_TITLE, {
            description: getErrorMessage(
              error,
              USER_MESSAGES.CREATE_ERROR_DESC
            ),
          });
        },
      }
    );
  }

  const roles = rolesData?.items || [];

  // Loading state: Fetching roles
  if (isLoadingRoles) {
    return (
      <PageContainer>
        {/* Accessibility: Announce loading state to screen readers */}
        <div className="sr-only" role="status" aria-live="polite">
          Loading roles...
        </div>

        {/* Breadcrumbs skeleton */}
        <div className="mb-6">
          <Skeleton className="h-5 w-64" />
        </div>

        {/* Header skeleton */}
        <div className="mb-8">
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>

        {/* Form skeleton */}
        <Skeleton className={`${FORM_MIN_HEIGHT} w-full rounded-none`} />
      </PageContainer>
    );
  }

  // Error state: Failed to fetch roles
  if (rolesError) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            <span>
              {getErrorMessage(rolesError, USER_MESSAGES.LOAD_ROLES_ERROR)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void refetchRoles();
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

  // Main render: Form loaded successfully
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div className="mb-6">
          <UserBreadcrumbs currentPage="create" />
        </div>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Create New User
            </h1>
            <p className="text-sm font-normal text-primary/50 mt-1">
              Add a new user to the system with appropriate role and
              permissions.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={ROUTES.USERS}>
              <Button type="button" variant="outline" disabled={isCreating}>
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              form="create-user-form"
              disabled={isCreating || !!rolesError}
            >
              {isCreating ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Creating User...
                </>
              ) : rolesError ? (
                "Cannot Create (Roles Failed)"
              ) : (
                "Create User"
              )}
            </Button>
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-card border border-border rounded-none p-6 shadow-none">
          {/* Avatar Section */}
          <div className="flex items-center gap-4 mb-8 pb-8 border-b border-border">
            <AvatarUploader
              value={watchedAvatar ?? ""}
              onChange={url =>
                setValue("avatarUrl", url, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              fullName={watchedFullName}
              disabled={isCreating}
            />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-foreground">
                {watchedFullName || "New User"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Fill in the details below to create a new user account.
              </p>
            </div>
          </div>

          {/* Form */}
          <FormProvider {...form}>
            <form
              id="create-user-form"
              onSubmit={e => {
                void handleSubmit(onSubmit)(e);
              }}
              className="space-y-8"
            >
              {/* Form Fields */}
              <UserFormFields
                mode="create"
                register={register}
                control={control}
                errors={errors}
                roles={roles}
                showActiveAccount={true}
              />

              <UserCustomFields
                control={control as unknown as Control<FieldValues>}
                errors={errors}
                disabled={isCreating}
              />
            </form>
          </FormProvider>
        </div>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
