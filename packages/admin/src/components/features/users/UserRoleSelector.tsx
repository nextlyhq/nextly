"use client";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@revnixhq/ui";
import { useState } from "react";

import { CheckIcon, ChevronDownIcon, X, Shield } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { Role } from "@admin/types/entities";

interface UserRoleSelectorProps {
  /** Selected role IDs (controlled) */
  value: string[];
  /** Callback when selection changes */
  onChange: (roleIds: string[]) => void;
  /** Available roles passed from parent (parent is responsible for fetching) */
  roles: Role[];
  /** Loading state — shows spinner and disables trigger */
  isLoading?: boolean;
  /** Error state — shows error alert with optional retry */
  error?: Error | null;
  /** Retry callback shown in error alert */
  onRetry?: () => void;
  /** Disables all interaction */
  disabled?: boolean;
  /** Form validation error message (from react-hook-form errors) */
  errorMessage?: string;
}

/**
 * UserRoleSelector
 *
 * Multi-select dropdown for assigning roles to a user.
 * Selected roles are shown as removable badge chips above the trigger.
 * Clicking the trigger opens a searchable popover listing all available roles.
 *
 * - System roles are visually distinguished with an amber (warning) badge and
 *   a shield icon, in both the selected chips and the dropdown list.
 * - Custom roles use the default (gray) badge style.
 * - The component is controlled: the parent manages state via `value` / `onChange`.
 * - Roles are passed as props — the parent page is responsible for fetching them
 *   (avoids duplicate network requests since create/edit pages already call useRoles).
 *
 * @example
 * ```tsx
 * <Controller
 *   name="roles"
 *   control={control}
 *   render={({ field, fieldState }) => (
 *     <UserRoleSelector
 *       value={field.value ?? []}
 *       onChange={field.onChange}
 *       roles={roles}
 *       isLoading={isLoadingRoles}
 *       error={rolesError}
 *       onRetry={refetchRoles}
 *       errorMessage={fieldState.error?.message}
 *     />
 *   )}
 * />
 * ```
 */
export function UserRoleSelector({
  value,
  onChange,
  roles,
  isLoading = false,
  error = null,
  onRetry,
  disabled = false,
  errorMessage,
}: UserRoleSelectorProps) {
  const [open, setOpen] = useState(false);

  const isSystemRole = (role: Role) => role.type === "System";

  // Roles currently selected (for badge display)
  const selectedRoles = roles.filter(role => value.includes(role.id));

  // Toggle a role in / out of selection
  const toggleRole = (roleId: string) => {
    if (value.includes(roleId)) {
      onChange(value.filter(id => id !== roleId));
    } else {
      onChange([...value, roleId]);
    }
  };

  // Remove a role from selection without opening the dropdown
  const removeRole = (roleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter(id => id !== roleId));
  };

  return (
    <div className="space-y-2">
      <Label>
        Roles <span className="text-destructive">*</span>
      </Label>
      <p className="text-xs text-muted-foreground">
        Select one or more roles to assign to this user
      </p>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Spinner size="md" />
          <span>Loading roles...</span>
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            <span>Failed to load roles. Please try again.</span>
            {onRetry && (
              <Button
                type="button"
                size="md"
                variant="outline"
                onClick={onRetry}
                className="ml-2 shrink-0"
              >
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Selector (only shown when not loading and no error) */}
      {!isLoading && !error && (
        <div className="space-y-2">
          {/* Selected role chips */}
          {selectedRoles.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5"
              role="list"
              aria-label="Assigned roles"
            >
              {selectedRoles.map(role => {
                const isSystem = isSystemRole(role);
                return (
                  <div
                    key={role.id}
                    role="listitem"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-none px-2.5 py-1 text-xs font-medium",
                      isSystem
                        ? "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100"
                        : "bg-primary/5 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                    )}
                  >
                    {isSystem && (
                      <Shield className="h-3 w-3 shrink-0" aria-hidden="true" />
                    )}
                    <span>{role.name}</span>
                    <button
                      type="button"
                      onClick={e => removeRole(role.id, e)}
                      disabled={disabled}
                      aria-label={`Remove ${role.name} role`}
                      className="ml-0.5 rounded-none p-0.5 hover-unified transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Trigger button + Popover dropdown */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label="Open role selector"
                disabled={disabled || roles.length === 0}
                className={cn(
                  "w-full justify-between h-auto py-3 px-4 font-normal transition-colors cursor-pointer",
                  selectedRoles.length > 0
                    ? "bg-slate-700 text-white hover-unified"
                    : "text-muted-foreground hover-unified"
                )}
              >
                <span>
                  {roles.length === 0
                    ? "No roles available"
                    : selectedRoles.length === 0
                      ? "Select roles..."
                      : `${selectedRoles.length} role${selectedRoles.length > 1 ? "s" : ""} selected`}
                </span>
                <ChevronDownIcon
                  className={cn(
                    "ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform duration-200",
                    open && "rotate-180"
                  )}
                  aria-hidden="true"
                />
              </Button>
            </PopoverTrigger>

            <PopoverContent
              className="w-[--radix-popover-trigger-width] min-w-[--radix-popover-trigger-width] max-w-[--radix-popover-trigger-width] p-0 overflow-hidden"
              align="start"
            >
              <Command className="w-full">
                <CommandInput
                  placeholder="Search roles..."
                  className="w-full"
                />
                <CommandList className="w-full overflow-x-hidden p-0">
                  <CommandEmpty>No roles found.</CommandEmpty>
                  <CommandGroup className="p-0">
                    {roles.map((role, index) => {
                      const isSelected = value.includes(role.id);
                      const isSystem = isSystemRole(role);

                      return (
                        <div
                          key={role.id}
                          className={cn(
                            index !== 0 && "mt-2",
                            "w-full overflow-hidden"
                          )}
                        >
                          <CommandItem
                            value={role.name}
                            onSelect={() => toggleRole(role.id)}
                            className="flex items-start gap-4 px-4 py-4 cursor-pointer w-full overflow-hidden hover-unified data-[selected=true]:bg-primary/5 data-[selected=true]:text-primary"
                          >
                            {/* Checkbox indicator */}
                            <div
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-none  border border-primary/5 transition-colors mt-0.5",
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-primary/5 bg-background"
                              )}
                              aria-hidden="true"
                            >
                              {isSelected && <CheckIcon className="h-3 w-3" />}
                            </div>

                            {/* Role info */}
                            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="font-medium text-sm leading-tight break-all">
                                  {role.name}
                                </span>
                                {isSystem && (
                                  <Badge
                                    variant="default"
                                    className="h-4 px-1.5 text-[10px] leading-none shrink-0"
                                  >
                                    System
                                  </Badge>
                                )}
                              </div>
                              {role.description && (
                                <p className="text-xs text-muted-foreground mt-1.5 leading-normal break-all">
                                  {role.description.length > 50
                                    ? `${role.description.substring(0, 50)}...`
                                    : role.description}
                                </p>
                              )}
                            </div>
                          </CommandItem>
                        </div>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Form validation error */}
      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
