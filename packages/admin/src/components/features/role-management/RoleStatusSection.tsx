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

  const getStatusColor = (id: string) => {
    switch (id) {
      case "active":
        return "text-success bg-success/10 border-success/20";
      case "inactive":
        return "text-warning bg-warning/10 border-warning/20";
      case "deprecated":
        return "text-destructive bg-destructive/10 border-destructive/20";
      default:
        return "text-muted-foreground bg-muted border-border";
    }
  };

  const getDotColor = (id: string) => {
    switch (id) {
      case "active":
        return "bg-success";
      case "inactive":
        return "bg-warning";
      case "deprecated":
        return "bg-destructive";
      default:
        return "bg-muted-foreground";
    }
  };

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
                      "group relative flex cursor-pointer items-center rounded-md border p-4 transition-all outline-none",
                      isChecked
                        ? "bg-primary/10 border-primary"
                        : "border-border bg-card hover-unified hover:border-primary/25",
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
                        "mr-3 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        isChecked ? "border-primary" : "border-border"
                      )}
                    >
                      {isChecked && (
                        <div className="h-2 w-2 rounded-full bg-primary" />
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

                    {/* Status Badge */}
                    <div
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border",
                        getStatusColor(option.id)
                      )}
                    >
                      <div
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          getDotColor(option.id)
                        )}
                      />
                      {option.name}
                    </div>
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
