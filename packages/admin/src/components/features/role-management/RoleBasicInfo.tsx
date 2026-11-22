import { FieldShell, Input, Textarea } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useFormState, type UseFormReturn } from "react-hook-form";

import { FormField } from "@admin/components/ui/form";
import type { RoleFormValuesType } from "@admin/hooks/useRoleForm";

interface RoleBasicInfoProps {
  form: UseFormReturn<RoleFormValuesType>;
  isEditMode: boolean;
  isSystemRole: boolean;
  isLoading: boolean;
  handleNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function RoleBasicInfo({
  form,
  isEditMode,
  isSystemRole,
  isLoading,
  handleNameChange,
}: RoleBasicInfoProps): JSX.Element {
  // A new role's slug is made from its name, so while the name has an error
  // the slug's own says the same thing again, on a field the name fills in:
  // the name's error alone is shown.
  const { errors } = useFormState({ control: form.control, name: "name" });
  const slugFollowsName = !isEditMode && errors.name !== undefined;
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FieldShell
            label={
              <>
                Name <span className="text-danger-text">*</span>
              </>
            }
            error={fieldState.error?.message}
          >
            <Input
              placeholder="Manager"
              {...field}
              onChange={e => {
                field.onChange(e);
                handleNameChange(e);
              }}
              disabled={isLoading || isSystemRole}
              aria-required="true"
            />
          </FieldShell>
        )}
      />

      <FormField
        control={form.control}
        name="slug"
        render={({ field, fieldState }) => (
          <FieldShell
            label="Slug"
            description="Auto-generated from the name field."
            error={slugFollowsName ? undefined : fieldState.error?.message}
          >
            <Input
              placeholder="manager"
              {...field}
              disabled={isLoading || isSystemRole}
              aria-required="true"
              className="bg-primary/5 font-mono text-sm"
            />
          </FieldShell>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field, fieldState }) => (
          <FieldShell
            label="Description"
            error={fieldState.error?.message}
            width="fill"
          >
            <Textarea
              placeholder="Describe the role's permissions..."
              {...field}
              // A built-in role saves its permissions alone.
              disabled={isLoading || isSystemRole}
              className="min-h-[100px] resize-none"
            />
          </FieldShell>
        )}
      />
    </>
  );
}
