import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useRef } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";

import { toast } from "@admin/components/ui";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import type { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import { normalizePermissions } from "@admin/lib/permissions/normalize";
import { roleApi } from "@admin/services/roleApi";

/**
 * Constant for "None" selection value in role inheritance
 */
const NONE_VALUE = "__none__" as const;

interface RoleInheritanceProps {
  form: UseFormReturn<RoleFormValuesType>;
  allRoles: Array<{ id: string; name: string; permissions: string[] }>;
  selectedBaseRoleIds: string[];
  setSelectedBaseRoleIds: (ids: string[]) => void;
  setRolePermissionsMap: (map: Record<string, string[]>) => void;
  lockedPermissionIds: string[];
  setLockedPermissionIds: (ids: string[]) => void;
}

/**
 * Where a role starts: an existing role it takes its permissions from, plus
 * whatever is ticked on top.
 *
 * One base, not several. A role built on one other role can be read in a
 * sentence, which is the only reason inheritance is safe to have here at all —
 * resolving it is otherwise invisible, and invisible resolution is why the
 * comparable systems avoid inheritance entirely and compose visible bundles
 * instead. Several bases, each contributing some unnameable part of the
 * result, is the thing they are avoiding.
 *
 * Inherited permissions are locked: they come from the base, so the way to
 * remove one is to change the base rather than to untick it here and produce a
 * role whose name no longer describes it.
 */
export function RoleInheritance({
  form,
  allRoles,
  selectedBaseRoleIds,
  setSelectedBaseRoleIds,
  setRolePermissionsMap,
  lockedPermissionIds,
  setLockedPermissionIds,
}: RoleInheritanceProps) {
  // Subscribed, not sampled. `getValues` reads once per render and nothing
  // above this component renders on a permission change — the permission
  // matrix is its own controller, and the only form state anyone here
  // subscribes to is `isDirty`, which flips once and never again. So a sampled
  // read went stale after the first tick: the summary below kept reporting the
  // count from that first render, and changing the base afterwards dropped
  // every permission ticked since.
  const watchedPermissions = useWatch({
    control: form.control,
    name: "permissions",
  });

  // Only rendered when a base can be chosen — but after the hooks above, which
  // must run on every render.
  const selectedIds = watchedPermissions ?? [];

  const baseRoleId = selectedBaseRoleIds[0];
  const baseRole = allRoles.find(r => r.id === baseRoleId);

  /** Permissions ticked on top of whatever the base already grants. */
  const extras = selectedIds.filter(id => !lockedPermissionIds.includes(id));

  // Only the newest selection may commit. Two selections in quick succession
  // race, and the loser landing last would restore the base the user just
  // moved away from — along with its locks and permissions.
  const selectionRef = useRef(0);

  const clearBase = () => {
    selectionRef.current += 1;
    setLockedPermissionIds([]);
    setSelectedBaseRoleIds([]);
    setRolePermissionsMap({});
    form.setValue("permissions", extras, { shouldDirty: true });
  };

  const chooseBase = async (roleId: string) => {
    const selection = ++selectionRef.current;

    try {
      // Read the base's permissions now rather than trusting the list, which
      // was loaded when the page was.
      const fresh = await roleApi.getRoleById(roleId);
      if (selection !== selectionRef.current) return;

      const inherited = normalizePermissions(fresh.permissions);

      setRolePermissionsMap({ [roleId]: inherited });
      setLockedPermissionIds(inherited);
      setSelectedBaseRoleIds([roleId]);

      // Replaces, not merges: one base means the previous base's permissions
      // leave with it, while anything ticked by hand stays ticked.
      form.setValue(
        "permissions",
        Array.from(new Set([...extras, ...inherited])),
        {
          shouldDirty: true,
        }
      );
    } catch {
      if (selection !== selectionRef.current) return;
      const name = allRoles.find(r => r.id === roleId)?.name ?? roleId;
      toast.error(`Failed to load permissions for role ${name}`);
    }
  };

  const handleSelection = async (value: string) => {
    if (!value || value === NONE_VALUE) {
      clearBase();
      return;
    }
    if (value === baseRoleId) return;
    await chooseBase(value);
  };

  if (allRoles.length === 0) {
    return null;
  }

  return (
    <FormField
      control={form.control}
      name="baseRoleId"
      render={() => (
        <FormItem>
          <FormLabel>Start from</FormLabel>
          {/*
            Undefined rather than the sentinel when there is no base: the
            trigger only renders an item's text for a value whose item is
            mounted, and items are not mounted while the list is closed. Left
            as the sentinel, the closed trigger reads as blank.
          */}
          <Select
            value={baseRoleId}
            onValueChange={value => {
              void handleSelection(value);
            }}
          >
            {/*
              Wrapped so the trigger takes the form item's id: the label points
              at that id, and without it the combobox announces with no name.
            */}
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Nothing — choose every permission by hand" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>
                Nothing — choose every permission by hand
              </SelectItem>
              {allRoles.map(roleOpt => (
                <SelectItem key={roleOpt.id} value={roleOpt.id}>
                  {roleOpt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/*
            The resolved effect, in a sentence, and visible rather than behind
            a hover. Inheritance resolves where nobody can see it, so saying
            the outcome plainly is the thing that makes it safe to have here at
            all — a summary you have to discover is not one anybody reads.
            FormDescription would put this in a tooltip, which is why it is
            not used.
          */}
          <p className="text-sm text-muted-foreground">
            {baseRole
              ? `This role can do everything ${baseRole.name} can${
                  extras.length > 0
                    ? `, plus ${extras.length} permission${
                        extras.length === 1 ? "" : "s"
                      } ticked below`
                    : ""
                }. Inherited permissions are locked; change the base to remove them.`
              : "Pick a role to build on, or leave this alone and choose every permission yourself."}
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
