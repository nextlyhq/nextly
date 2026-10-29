import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  FormActions,
} from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";
import { FormProvider } from "react-hook-form";

import { SettingsSection } from "@admin/components/features/settings";
import { Loader2, AlertTriangle } from "@admin/components/icons";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useDocumentTitle } from "@admin/hooks/useDocumentTitle";
import { useRoleCopy } from "@admin/hooks/useRoleCopy";
import { useRoleForm } from "@admin/hooks/useRoleForm";
import { pluginDisplayName } from "@admin/lib/plugins/plugin-display-name";
import {
  screenSaves,
  type RoleScreenMode,
} from "@admin/lib/roles/role-screen-mode";
import type { RoleFormProps } from "@admin/types/ui/form";

import { RoleBasicInfo } from "./RoleBasicInfo";
import { RoleInheritance } from "./RoleInheritance";
import { RolePermissionsSection } from "./RolePermissionsSection";

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
 *
 * The component now focuses solely on layout and composition.
 */
export function RoleForm({ roleId }: RoleFormProps): JSX.Element {
  const {
    form,
    role,
    levelRows,
    pluginGroups,
    otherPermissions,
    baseGrants,
    allRoles,
    isLoading,
    error,
    isEditMode,
    isSystemRole,
    screenMode,
    selectedBaseRoleIds,
    setSelectedBaseRoleIds,
    lockedPermissionIds,
    setLockedPermissionIds,
    setRolePermissionsMap,
    onSubmit,
    handleNameChange,
    handleCancel,
    formRef,
  } = useRoleForm(roleId);
  // A preset is changed by copying it into a new role, which starts from it.
  const copyRole = useRoleCopy(roleId, form);
  // Each plugin as the admin names it everywhere, by its package name.
  const { plugins } = useBranding();
  const pluginNames = new Map(
    (plugins ?? []).map(plugin => [plugin.name, pluginDisplayName(plugin)])
  );

  // The tab names the role being edited by its name as loaded, which is also
  // its name as last saved, not by the name field: a tab that followed the
  // field would rename itself on every keystroke of an edit not yet saved.
  // A new role has none yet, so the create screen keeps the screen's name.
  useDocumentTitle(role?.name);

  // A built-in role is never built on another.
  const builtIn = screenMode !== "editable";

  return (
    <>
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="mb-6">
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
          {/* Page header. The submit button now lives in FormActions, at the
              end of the form, but keeps the `form="role-form"` attribute so it
              still targets this form regardless of where in the DOM it sits. */}
          <div className="pb-6">
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
            {/* Top section: Role Details (full width).

                Neither this wrapper nor the Permissions one below pads itself
                vertically. `SettingsSection` applies the rhythm to every direct
                child through `--nx-field-gap`, and the two paddings are
                additive, so a wrapper that restored its own would render at
                double the gap on exactly the sections that already looked
                correct. */}
            <SettingsSection label="Role Details">
              <div className="flex flex-col gap-6">
                <RoleBasicInfo
                  form={form}
                  isEditMode={isEditMode}
                  isSystemRole={isSystemRole}
                  isLoading={isLoading}
                  handleNameChange={handleNameChange}
                />

                {/* Base Role Selector (Inheritance) */}
                {!builtIn && (
                  <RoleInheritance
                    form={form}
                    allRoles={allRoles}
                    selectedBaseRoleIds={selectedBaseRoleIds}
                    setSelectedBaseRoleIds={setSelectedBaseRoleIds}
                    setRolePermissionsMap={setRolePermissionsMap}
                    lockedPermissionIds={lockedPermissionIds}
                    setLockedPermissionIds={setLockedPermissionIds}
                  />
                )}
              </div>
            </SettingsSection>

            {/* Bottom section: Permissions (full width) */}
            <SettingsSection label="Permissions">
              <RolePermissionsArea
                screenMode={screenMode}
                copyRole={copyRole}
                isLoading={isLoading}
              >
                <RolePermissionsSection
                  form={form}
                  levelRows={levelRows}
                  pluginGroups={pluginGroups}
                  pluginNames={pluginNames}
                  otherPermissions={otherPermissions}
                  lockedPermissionIds={lockedPermissionIds}
                  bases={baseGrants}
                  isLoading={isLoading}
                  readOnly={screenMode === "preset"}
                  visitors={screenMode === "public"}
                />
              </RolePermissionsArea>
            </SettingsSection>

            {/* Field-Level Permissions and RLS Policies are deferred to future plans */}

            <FormActions dirty={form.formState.isDirty}>
              <Button
                variant="outline"
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              {screenSaves(screenMode) && (
                <SaveRoleButton isLoading={isLoading} isEditMode={isEditMode} />
              )}
            </FormActions>
          </form>
        </FormProvider>
      )}
    </>
  );
}

/**
 * The Permissions section's body for a role shown as `screenMode`:
 * super-admin's line alone, since it holds every permission; otherwise the
 * permissions (`children`) under a line saying what they are, which for a
 * preset offers a copy to change.
 */
function RolePermissionsArea({
  screenMode,
  copyRole,
  isLoading,
  children,
}: {
  screenMode: RoleScreenMode;
  copyRole: () => void;
  isLoading: boolean;
  children: ReactNode;
}): JSX.Element {
  if (screenMode === "super-admin") {
    return (
      <p className="text-sm text-muted-foreground">
        Super-admins have every permission, including new collections and
        plugins. This role can&apos;t be edited.
      </p>
    );
  }
  return (
    <div className="-mx-6">
      {screenMode === "public" && (
        <p className="px-6 text-sm text-foreground mb-2">
          This is what visitors who aren&apos;t signed in can see.
        </p>
      )}
      {screenMode === "preset" ? (
        <div className="px-6 mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            This role comes with Nextly, so its permissions can&apos;t be
            changed. Copy it to make a role you can change.
          </p>
          <Button
            variant="outline"
            type="button"
            onClick={copyRole}
            disabled={isLoading}
          >
            Copy to change
          </Button>
        </div>
      ) : (
        <p className="px-6 text-sm text-muted-foreground mb-4">
          Choose a level for each collection and Single, or turn on Each action
          to choose its actions one by one.
        </p>
      )}
      {children}
    </div>
  );
}

/** The form's save, naming whether it updates the role or creates it. */
function SaveRoleButton({
  isLoading,
  isEditMode,
}: {
  isLoading: boolean;
  isEditMode: boolean;
}): JSX.Element {
  return (
    <Button type="submit" form={ROLE_FORM_ID} disabled={isLoading}>
      {isLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{isEditMode ? "Updating..." : "Creating..."}</span>
          <span className="sr-only">
            {isEditMode ? "Updating role" : "Creating role"}
          </span>
        </>
      ) : (
        <span>{isEditMode ? "Update Role" : "Create Role"}</span>
      )}
    </Button>
  );
}
