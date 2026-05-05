import { Alert, AlertDescription, AlertTitle, Button } from "@revnixhq/ui";
import { FormProvider } from "react-hook-form";

import { SettingsSection } from "@admin/components/features/settings";
import { Loader2, AlertTriangle } from "@admin/components/icons";
import { useRoleForm } from "@admin/hooks/useRoleForm";
import type { RoleFormProps } from "@admin/types/ui/form";

import { RoleBasicInfo } from "./RoleBasicInfo";
import { RoleInheritance } from "./RoleInheritance";
import { RolePermissionsSection } from "./RolePermissionsSection";
import { RoleStatusSection } from "./RoleStatusSection";

/**
 * Form id used by external buttons (e.g. page-header actions)
 */
export const ROLE_FORM_ID = "role-form";

/**
 * RoleForm Component
 *
 * Main orchestrator component for role creation and editing.
 * This component has been refactored from 923 LOC to ~150 LOC by extracting:
 * - Data loading and form logic → useRoleForm hook
 * - Basic info fields → RoleBasicInfo component
 * - Role inheritance → RoleInheritance component
 * - Permission selection → RolePermissionsSection component
 * - Status fields → RoleStatusSection component
 *
 * The component now focuses solely on layout and composition.
 */
export function RoleForm({ roleId }: RoleFormProps) {
  const {
    form,
    allPermissions,
    allRoles,
    isLoading,
    error,
    isEditMode,
    isSystemRole,
    selectedBaseRoleIds,
    setSelectedBaseRoleIds,
    lockedPermissionIds,
    setLockedPermissionIds,
    rolePermissionsMap,
    setRolePermissionsMap,
    onSubmit,
    handleNameChange,
    handleCancel,
    statusOptions,
    formRef,
  } = useRoleForm(roleId);

  return (
    <div className="space-y-6">
      {/* Error Alert */}

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading Spinner */}
      {isLoading && !form.formState.isSubmitting ? (
        <div
          className="flex h-[400px] w-full items-center justify-center"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="sr-only">Loading role data...</span>
        </div>
      ) : (
        <FormProvider {...form}>
          {/* Page header (sits above the form, but the submit button targets the
              form via the `form="role-form"` attribute so we still get a single
              submit even though the buttons live outside the <form> element). */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
            <div>
              <h1
                id="role-form-title"
                className="text-xl font-semibold text-foreground"
              >
                {isEditMode ? "Edit Role" : "Create New Role"}
              </h1>
              <p className="text-muted-foreground mt-1">
                {isEditMode
                  ? "Update role info and permissions."
                  : "Define role info and assign permissions."}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" form={ROLE_FORM_ID} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>{isEditMode ? "Updating..." : "Creating..."}</span>
                    <span className="sr-only">
                      {isEditMode ? "Updating role" : "Creating role"}
                    </span>
                  </>
                ) : (
                  <span>{isEditMode ? "Update Role" : "Create Role"}</span>
                )}
              </Button>
            </div>
          </div>

          <form
            id={ROLE_FORM_ID}
            ref={formRef}
            onSubmit={e => {
              void onSubmit(e);
            }}
            className="space-y-6"
            aria-labelledby="role-form-title"
            noValidate
          >
            {/* Top section: Role Details (full width) */}
            <SettingsSection label="Role Details">
              <div className="flex flex-col gap-6 py-5">
                <RoleBasicInfo
                  form={form}
                  isEditMode={isEditMode}
                  isSystemRole={isSystemRole}
                  isLoading={isLoading}
                  handleNameChange={handleNameChange}
                />

                {/* Base Role Selector (Inheritance) */}
                <RoleInheritance
                  form={form}
                  allRoles={allRoles}
                  selectedBaseRoleIds={selectedBaseRoleIds}
                  setSelectedBaseRoleIds={setSelectedBaseRoleIds}
                  rolePermissionsMap={rolePermissionsMap}
                  setRolePermissionsMap={setRolePermissionsMap}
                  lockedPermissionIds={lockedPermissionIds}
                  setLockedPermissionIds={setLockedPermissionIds}
                />

                {/* Status and Priority (only in create mode for non-system roles) */}
                <RoleStatusSection
                  form={form}
                  isLoading={isLoading}
                  isSystemRole={isSystemRole}
                  isEditMode={isEditMode}
                  statusOptions={statusOptions}
                />
              </div>
            </SettingsSection>

            {/* Bottom section: Permissions (full width) */}
            <SettingsSection label="Permissions">
              <div className="py-5 -mx-6">
                <p className="px-6 text-sm text-muted-foreground mb-4">
                  Only actions bound by a route are listed below.
                </p>
                <RolePermissionsSection
                  form={form}
                  allPermissions={allPermissions}
                  lockedPermissionIds={lockedPermissionIds}
                  isLoading={isLoading}
                />
              </div>
            </SettingsSection>

            {/* Field-Level Permissions and RLS Policies are deferred to future plans */}
          </form>
        </FormProvider>
      )}
    </div>
  );
}
