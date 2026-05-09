import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import type { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import { cn } from "@admin/lib/utils";

interface RoleStatusSectionProps {
  form: UseFormReturn<RoleFormValuesType>;
  isLoading: boolean;
  isSystemRole: boolean;
  isEditMode: boolean;
  statusOptions: Array<{ id: string; name: string; description: string }>;
}

export function RoleStatusSection({
  form,
  isLoading,
  isSystemRole,
  isEditMode,
  statusOptions,
}: RoleStatusSectionProps) {
  // Only show status and priority in create mode for non-system roles
  if (isSystemRole || isEditMode) {
    return null;
  }

  return (
    <>
      <FormField
        control={form.control}
        name="status"
        render={({ field }) => (
          <FormItem className="space-y-4">
            <FormLabel className="text-base font-medium text-foreground">
              Status
            </FormLabel>
            <div className="space-y-3">
              {statusOptions.map(option => {
                const isChecked = field.value === option.id;
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "group relative flex cursor-pointer items-center rounded-none  border border-primary/5 p-4 transition-all outline-none",
                      isChecked
                        ? "bg-primary/5 border-primary"
                        : "border-primary/5 bg-card hover-unified hover:border-primary/25",
                      isLoading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <FormControl>
                      <input
                        type="radio"
                        value={option.id}
                        className="sr-only"
                        checked={isChecked}
                        onChange={() => field.onChange(option.id)}
                        disabled={isLoading}
                        aria-describedby={`status-${option.id}-description`}
                      />
                    </FormControl>

                    {/* Custom Radio Circle */}
                    <div
                      className={cn(
                        "mr-3 flex h-4 w-4 shrink-0 items-center justify-center rounded-none  border border-primary/5",
                        isChecked ? "border-primary" : "border-primary/5"
                      )}
                    >
                      {isChecked && (
                        <div className="h-2 w-2 rounded-none bg-primary" />
                      )}
                    </div>

                    <span
                      className={cn(
                        "flex-1 font-medium transition-colors",
                        isChecked
                          ? "text-primary"
                          : "text-foreground group-hover-unified"
                      )}
                    >
                      {option.name}
                    </span>
                  </label>
                );
              })}
            </div>

            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
