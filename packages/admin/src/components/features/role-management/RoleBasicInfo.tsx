import { FieldShell, Input, Textarea } from "@nextlyhq/ui";
import type { UseFormReturn } from "react-hook-form";

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
  isSystemRole,
  isLoading,
  handleNameChange,
}: RoleBasicInfoProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FieldShell
            label={
              <>
                Name <span className="text-destructive-500">*</span>
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
            error={fieldState.error?.message}
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
              disabled={isLoading}
              className="min-h-[100px] resize-none"
            />
          </FieldShell>
        )}
      />
    </>
  );
}
