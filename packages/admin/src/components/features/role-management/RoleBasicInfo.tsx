import { Input, Textarea } from "@revnixhq/ui";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
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
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium text-foreground">
              Name <span className="text-red-500">*</span>
            </FormLabel>
            <FormControl>
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
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="slug"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium text-foreground">
              Slug
            </FormLabel>
            <FormControl>
              <Input
                placeholder="manager"
                {...field}
                disabled={isLoading || isSystemRole}
                aria-required="true"
                className="bg-muted font-mono text-sm"
              />
            </FormControl>
            <p className="text-xs text-muted-foreground mt-1.5 ml-0.5">
              Auto-generated from the name field.
            </p>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium text-foreground">
              Description
            </FormLabel>
            <FormControl>
              <Textarea
                placeholder="Describe the role's permissions..."
                {...field}
                disabled={isLoading}
                className="min-h-[100px] resize-none"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
