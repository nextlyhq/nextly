/**
 * The Public role's permissions section offers visitors no publish, in the
 * table of the permissions that have no level row as in the rows: a visitor
 * never publishes.
 */
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import type { Permission } from "@admin/types/ui/form";

import { RolePermissionsSection } from "./RolePermissionsSection";

const OTHER: Permission[] = [
  {
    id: "read-releases",
    name: "Read releases",
    resource: "content-releases",
    action: "read",
  },
  {
    id: "publish-releases",
    name: "Publish releases",
    resource: "content-releases",
    action: "publish",
  },
];

function Section({ visitors }: { visitors: boolean }) {
  const form = useForm<RoleFormValuesType>({
    defaultValues: { permissions: [] } as unknown as RoleFormValuesType,
  });
  return (
    <FormProvider {...form}>
      <RolePermissionsSection
        form={form}
        levelRows={[]}
        pluginGroups={[]}
        pluginNames={new Map()}
        otherPermissions={OTHER}
        lockedPermissionIds={[]}
        bases={[]}
        isLoading={false}
        visitors={visitors}
      />
    </FormProvider>
  );
}

describe("RolePermissionsSection", () => {
  it("offers visitors no publish in the table of other permissions", () => {
    const { unmount } = render(<Section visitors={false} />);
    // CONTROL: another role's table offers it.
    expect(
      screen.queryAllByRole("checkbox", { name: /publish/i }).length
    ).toBeGreaterThan(0);
    unmount();

    render(<Section visitors />);
    expect(screen.queryAllByRole("checkbox", { name: /publish/i })).toEqual([]);
    expect(
      screen.queryAllByRole("checkbox", { name: /read/i }).length
    ).toBeGreaterThan(0);
  });
});
