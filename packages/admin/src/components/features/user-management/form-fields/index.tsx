"use client";

import { Checkbox, Input, Label } from "@revnixhq/ui";
import { useState } from "react";
import type {
  Control,
  FieldErrors,
  UseFormRegister} from "react-hook-form";
import {
  Controller,
} from "react-hook-form";

import { UserRoleSelector } from "@admin/components/features/users/UserRoleSelector";
import { Eye, EyeOff } from "@admin/components/icons";
import type { Role } from "@admin/types/entities";
import type {
  CreateUserFormValues,
} from "@admin/types/userform";

interface UserFormFieldsProps {
  /**
   * Form mode: "create" or "edit"
   * Determines field requirements and which fields to show
   */
  mode: "create" | "edit";

  /**
   * React Hook Form register function
   * Used to register input fields with the form
   */
  register: UseFormRegister<CreateUserFormValues  >;

  /**
   * React Hook Form control object
   * Used for Controller components (checkboxes, etc.)
   */
  control: Control<CreateUserFormValues  >;

  /**
   * React Hook Form errors object
   * Contains validation errors for all fields
   */
  errors: FieldErrors<CreateUserFormValues  >;

  /**
   * Available roles to display in the roles list
   */
  roles: Role[];

  /**
   * Loading state for roles fetch
   * Shows spinner in edit mode when roles are loading
   */
  isLoadingRoles?: boolean;

  /**
   * Error state for roles fetch
   * Shows error alert in edit mode when roles fail to load
   */
  rolesError?: Error | null;

  /**
   * Callback to retry loading roles
   * Called when user clicks "Retry" button in error alert
   */
  onRetryRoles?: () => void;

  /**
   * Whether to show the Active Account checkbox
   * Shown in both create and edit modes
   * @default false
   */
  showActiveAccount?: boolean;
}

/**
 * UserFormFields Component
 *
 * Shared form fields for Create User and Edit User pages.
 * Handles the ~80% code duplication between the two forms.
 *
 * Features:
 * - Full Name, Email, Password inputs
 * - Roles selection with checkboxes
 * - Active Account toggle (create mode)
 * - Send Welcome Email toggle (create mode only)
 * - Conditional password field (required in create, optional in edit)
 * - Loading and error states for roles (edit mode)
 *
 * @example
 * ```tsx
 * // In Create User page
 * <UserFormFields
 *   mode="create"
 *   register={register}
 *   control={control}
 *   errors={errors}
 *   roles={roles}
 *   showActiveAccount={true}
 * />
 *
 * // In Edit User page
 * <UserFormFields
 *   mode="edit"
 *   register={register}
 *   control={control}
 *   errors={errors}
 *   roles={roles}
 *   isLoadingRoles={isLoadingRoles}
 *   rolesError={rolesError}
 *   onRetryRoles={refetchRoles}
 * />
 * ```
 */
export function UserFormFields({
  mode,
  register,
  control,
  errors,
  roles,
  isLoadingRoles = false,
  rolesError = null,
  onRetryRoles,
  showActiveAccount = false,
}: UserFormFieldsProps) {
  const isCreateMode = mode === "create";
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-12 md:gap-x-[10rem] w-full">
      {/* Left Column - User Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          User Details
        </h3>

        {/* Full Name Field */}
        <div>
          <Label htmlFor="fullName" className="mb-2">
            Full Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="fullName"
            placeholder="John Doe"
            aria-invalid={!!errors.fullName}
            aria-required="true"
            {...register("fullName")}
          />
          {errors.fullName && (
            <p className="text-sm text-destructive mt-1">
              {errors.fullName.message}
            </p>
          )}
        </div>

        {/* Email Field */}
        <div>
          <Label htmlFor="email" className="mb-2">
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="john.doe@example.com"
            aria-invalid={!!errors.email}
            aria-required="true"
            {...register("email")}
          />
          {errors.email && (
            <p className="text-sm text-destructive mt-1">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password Field - Required in create, optional in edit */}
        <div>
          <Label htmlFor="password" className="mb-2">
            Password{" "}
            {isCreateMode && <span className="text-destructive">*</span>}
            {!isCreateMode && " (optional)"}
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Min 8 chars, uppercase, lowercase, number, special (@$!%*?&#.)"
              aria-invalid={!!errors.password}
              aria-required={isCreateMode}
              {...register("password")}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {!isCreateMode && (
            <p className="text-xs text-muted-foreground mt-1">
              Only enter a new password if you want to reset it. Leave empty to
              keep the current password.
            </p>
          )}
          {errors.password && (
            <p className="text-sm text-destructive mt-1">
              {errors.password.message}
            </p>
          )}
        </div>
      </div>

      {/* Right Column - Roles & Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Roles & Settings
        </h3>

        {/* Roles Selection */}
        <Controller
          name="roles"
          control={control}
          render={({ field, fieldState }) => (
            <UserRoleSelector
              value={field.value ?? []}
              onChange={field.onChange}
              roles={roles}
              isLoading={isLoadingRoles}
              error={rolesError}
              onRetry={onRetryRoles}
              errorMessage={fieldState.error?.message}
            />
          )}
        />

        {/* Account Settings */}
        {(showActiveAccount || isCreateMode) && (
          <div className="space-y-3">
            {/* Active Account Checkbox */}
            {showActiveAccount && (
              <div className="rounded-none  border border-primary/5 border-primary/5 dark:border-primary/30 bg-primary/5 p-3 shadow-none">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Controller
                    control={control}
                    name="active"
                    render={({ field }) => (
                      <Checkbox
                        checked={!!field.value}
                        onCheckedChange={val => field.onChange(!!val)}
                        className="mt-0.5"
                      />
                    )}
                  />
                  <div>
                    <div className="text-sm font-semibold text-primary">
                      Active Account (Default: Yes)
                    </div>
                    <p className="text-xs text-primary/70">
                      User will be able to log in immediately after creation.
                      Uncheck to require manual activation later.
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Send Welcome Email Checkbox (create mode only) */}
            {isCreateMode && (
              <div className="rounded-none  border border-primary/5 p-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Controller
                    control={control}
                    name="sendWelcome"
                    render={({ field }) => (
                      <Checkbox
                        checked={!!field.value}
                        onCheckedChange={val => field.onChange(!!val)}
                        className="mt-0.5"
                      />
                    )}
                  />
                  <div>
                    <div className="text-sm font-medium">
                      Send Welcome Email
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Send an email with login credentials after account
                      creation.
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
