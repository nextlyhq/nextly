"use client";

import {
  Checkbox,
  FieldShell,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@nextlyhq/ui";
import { useState } from "react";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";

import { UserRoleSelector } from "@admin/components/features/users/UserRoleSelector";
import { Eye, EyeOff } from "@admin/components/icons";
import type { Role } from "@admin/types/entities";
import type { CreateUserFormValues } from "@admin/types/userform";

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
  register: UseFormRegister<CreateUserFormValues>;

  /**
   * React Hook Form control object
   * Used for Controller components (checkboxes, etc.)
   */
  control: Control<CreateUserFormValues>;

  /**
   * React Hook Form errors object
   * Contains validation errors for all fields
   */
  errors: FieldErrors<CreateUserFormValues>;

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
 * - Full Name, Email inputs
 * - Sign-in method choice (create mode): send a set-password link or set a
 *   password now. The password fields appear only when setting one now.
 * - Password input (always in edit mode; create mode only when setting one now)
 * - Roles selection with checkboxes
 * - Active Account toggle
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

  // Create mode only: the sign-in method decides whether the password fields
  // are shown at all. Edit mode always shows an (optional) password field.
  const signInMethod = useWatch({ control, name: "signInMethod" });
  const isInviteMode = isCreateMode && signInMethod === "invite";
  const showPasswordField = !isInviteMode;

  return (
    // Not a `Grid` candidate: this is the page's own two-column split, not a
    // row of same-sized fields, and it needs an asymmetric row/column gap
    // (`gap-y-12`, `gap-x-[10rem]`) that `Grid`'s single `gap` prop — capped
    // at `8` (2rem) — cannot express. Left as its original viewport grid.
    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-12 md:gap-x-[10rem] w-full">
      {/* Left Column - User Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          User Details
        </h3>

        {/* Full Name Field */}
        <FieldShell
          label={
            <>
              Full Name <span className="text-destructive">*</span>
            </>
          }
          error={errors.fullName?.message}
        >
          <Input
            placeholder="John Doe"
            aria-required="true"
            {...register("fullName")}
          />
        </FieldShell>

        {/* Email Field */}
        <FieldShell
          label={
            <>
              Email <span className="text-destructive">*</span>
            </>
          }
          error={errors.email?.message}
        >
          <Input
            type="email"
            placeholder="john.doe@nextly.local"
            aria-required="true"
            {...register("email")}
          />
        </FieldShell>

        {/* Sign-in method (create only). The choice changes what the form
            means: an invite link the person redeems, or a password the admin
            hands over — so it is asked up front, not tucked into settings. */}
        {isCreateMode && (
          <div>
            <Label className="mb-2">How should this person sign in?</Label>
            <Controller
              control={control}
              name="signInMethod"
              render={({ field }) => (
                <RadioGroup
                  value={(field.value as string) ?? "invite"}
                  onValueChange={field.onChange}
                  className="gap-3"
                >
                  <label
                    htmlFor="sign-in-invite"
                    className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer"
                  >
                    <RadioGroupItem
                      value="invite"
                      id="sign-in-invite"
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">
                        Send a set-password link{" "}
                        <span className="font-normal text-muted-foreground">
                          (recommended)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        They choose their own password from a secure link. You
                        never see it.
                      </p>
                    </div>
                  </label>
                  <label
                    htmlFor="sign-in-password"
                    className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer"
                  >
                    <RadioGroupItem
                      value="password"
                      id="sign-in-password"
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">
                        Set a password now
                      </div>
                      <p className="text-xs text-muted-foreground">
                        For handing over credentials directly. They can change
                        it after signing in.
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              )}
            />
          </div>
        )}

        {/* Password Field - always in edit; create only when setting one now.
            Rendered via FieldShell's render-function children: the reveal
            button sits beside the Input inside one wrapping div, so the
            single-element clone form would attach the id to that div instead
            of the real control. */}
        {showPasswordField && (
          <FieldShell
            label={
              <>
                Password{" "}
                {isCreateMode && <span className="text-destructive">*</span>}
                {!isCreateMode && " (optional)"}
              </>
            }
            description={
              !isCreateMode
                ? "Only enter a new password if you want to reset it. Leave empty to keep the current password."
                : undefined
            }
            error={errors.password?.message}
          >
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  type={showPassword ? "text" : "password"}
                  placeholder="Min 8 chars, uppercase, lowercase, number, special (@$!%*?&#.)"
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
            )}
          </FieldShell>
        )}
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

        {/* Account Settings. Hidden in invite mode: accepting the invite
            activates the account, so an "inactive" choice here would not hold —
            we do not offer a control the redemption step silently overrides. */}
        {showActiveAccount && !isInviteMode && (
          <div className="space-y-3">
            {/* Active Account Checkbox */}
            {/* Semantic border token so the boundary is visible at the 3:1 UI minimum. */}
            <div className="rounded-md  border border-border bg-primary/5 p-3 shadow-none">
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
                  {/* A field label, so it takes the page ink rather than the
                      action token. */}
                  <div className="text-sm font-semibold text-foreground">
                    Active Account (Default: Yes)
                  </div>
                  {/* Muted foreground so this secondary text meets contrast; a faint primary alpha did not. */}
                  <p className="text-xs text-muted-foreground">
                    User will be able to log in immediately after creation.
                    Uncheck to require manual activation later.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
