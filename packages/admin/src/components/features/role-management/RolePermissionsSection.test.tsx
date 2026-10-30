/**
 * The Public role's permissions section offers visitors no publish, in the
 * table of the permissions that have no level row as in the rows: a visitor
 * never publishes. A write held there is warned of, as in the rows.
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
    id: "update-releases",
    name: "Update releases",
    resource: "content-releases",
    action: "update",
  },
  {
    id: "publish-releases",
    name: "Publish releases",
    resource: "content-releases",
    action: "publish",
  },
];

function Section({
  visitors,
  held = [],
}: {
  visitors: boolean;
  held?: string[];
}) {
  const form = useForm<RoleFormValuesType>({
    defaultValues: { permissions: held } as unknown as RoleFormValuesType,
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

  it("warns that visitors can change entries where the table gives them a write", () => {
    const warning = /Visitors who aren't signed in can change/;
    const { unmount } = render(<Section visitors held={["update-releases"]} />);
    expect(screen.getByText(warning)).toBeInTheDocument();
    unmount();

    // CONTROLS: a read alone, or a write held by a signed-in role, is not.
    const read = render(<Section visitors held={["read-releases"]} />);
    expect(screen.queryByText(warning)).toBeNull();
    read.unmount();
    render(<Section visitors={false} held={["update-releases"]} />);
    expect(screen.queryByText(warning)).toBeNull();
  });
});
