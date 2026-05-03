import { Alert, AlertDescription, AlertTitle, Button } from "@revnixhq/ui";
import { FormProvider } from "react-hook-form";

import { Loader2, AlertTriangle } from "@admin/components/icons";
import { useRoleForm } from "@admin/hooks/useRoleForm";
import type { RoleFormProps } from "@admin/types/ui/form";

import { RoleBasicInfo } from "./RoleBasicInfo";
import { RoleInheritance } from "./RoleInheritance";
import { RolePermissionsSection } from "./RolePermissionsSection";
import { RoleStatusSection } from "./RoleStatusSection";

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
          <form
            ref={formRef}
            onSubmit={e => {
              void onSubmit(e);
            }}
            className="space-y-8"
            aria-labelledby="role-form-title"
            noValidate
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  {isEditMode ? "Edit Role" : "Create New Role"}
                </h1>
                <p className="text-muted-foreground mt-1">
                  {isEditMode
                    ? "Update role info and permissions."
                    : "Define role info and assign permissions."}
                </p>
              </div>

              {/* Form Actions (moved opposite title) */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleCancel}
                  disabled={isLoading}
                  className="h-10 px-4 text-sm font-medium border-primary/5"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="h-10 px-4 text-sm font-medium transition-transform active:scale-95"
                >
                  {isLoading ? (
                    <>
                      <Loader2
                        className="mr-2 h-4 w-4 animate-spin"
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

            <div className="flex flex-col gap-6 xl:flex-row items-start">
              {/* Left Sidebar Card - Role details */}
              <div className="flex w-full flex-col overflow-hidden rounded-none  border border-primary/5 bg-card xl:w-[380px] xl:shrink-0 sticky top-6">
                <div className="border-b border-primary/5 p-6">
                  <h2 className="text-lg font-semibold text-foreground">
                    Role details
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Name and description of the role
                  </p>
                </div>

                <div className="flex flex-col gap-6 p-6">
                  {/* Basic Info Fields */}
                  <div className="space-y-6">
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
                  </div>

                  {/* Status and Priority (only in create mode for non-system roles) */}
                  <RoleStatusSection
                    form={form}
                    isLoading={isLoading}
                    isSystemRole={isSystemRole}
                    isEditMode={isEditMode}
                    statusOptions={statusOptions}
                  />
                </div>
              </div>

              {/* Main Content Card - Permissions Card */}
              <div className="flex-1 w-full min-w-0">
                <div className="flex w-full flex-col overflow-hidden rounded-none  border border-primary/5 bg-card">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-1">
                      Permissions
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Only actions bound by a route are listed below.
                    </p>
                  </div>

                  <div className="pb-6 w-full max-w-full overflow-hidden">
                    <RolePermissionsSection
                      form={form}
                      allPermissions={allPermissions}
                      lockedPermissionIds={lockedPermissionIds}
                      isLoading={isLoading}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Field-Level Permissions and RLS Policies are deferred to future plans */}
          </form>
        </FormProvider>
      )}
    </div>
  );
}
