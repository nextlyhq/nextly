/**
 * RoleInheritance — one base role, and a sentence saying what that means.
 *
 * The effect summary is the load-bearing part rather than decoration.
 * Inheritance resolves out of sight, and stating the outcome in words is the
 * whole reason it is defensible to have here when the comparable systems chose
 * visible composition instead. A test on the sentence is a test on that.
 */
import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { Form } from "@admin/components/ui/form";
import { RoleFormValuesType } from "@admin/hooks/useRoleForm";

import { RoleInheritance } from "./RoleInheritance";

vi.mock("../../services/roleApi", () => ({
  roleApi: {
    getRoleById: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const ROLES = [
  { id: "r1", name: "Editor", permissions: ["p1", "p2"] },
  { id: "r2", name: "Author", permissions: ["p3"] },
];

function RoleInheritanceWrapper({
  defaultValues,
  allRoles = ROLES,
  selectedBaseRoleIds = [],
  setSelectedBaseRoleIds = vi.fn(),
  setRolePermissionsMap = vi.fn(),
  lockedPermissionIds = [],
  setLockedPermissionIds = vi.fn(),
}: {
  defaultValues?: Partial<RoleFormValuesType>;
  allRoles?: Array<{ id: string; name: string; permissions: string[] }>;
  selectedBaseRoleIds?: string[];
  setSelectedBaseRoleIds?: (ids: string[]) => void;
  setRolePermissionsMap?: (map: Record<string, string[]>) => void;
  lockedPermissionIds?: string[];
  setLockedPermissionIds?: (ids: string[]) => void;
}) {
  const form = useForm<RoleFormValuesType>({
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      permissions: [],
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form>
        <RoleInheritance
          form={form}
          allRoles={allRoles}
          selectedBaseRoleIds={selectedBaseRoleIds}
          setSelectedBaseRoleIds={setSelectedBaseRoleIds}
          setRolePermissionsMap={setRolePermissionsMap}
          lockedPermissionIds={lockedPermissionIds}
          setLockedPermissionIds={setLockedPermissionIds}
        />
      </form>
    </Form>
  );
}

describe("RoleInheritance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("asks what the role starts from", () => {
      render(<RoleInheritanceWrapper />);

      const label = screen.getByText("Start from");
      expect(label).toBeInTheDocument();
      expect(label.tagName).toBe("LABEL");
    });

    it("renders nothing when there is no role to build on", () => {
      const { container } = render(<RoleInheritanceWrapper allRoles={[]} />);

      expect(container.querySelector("form")).toBeEmptyDOMElement();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("offers a way to start from nothing", () => {
      render(<RoleInheritanceWrapper />);

      // Radix mirrors the select into a hidden native control for form
      // submission, so the placeholder legitimately appears more than once.
      expect(
        screen.getAllByText(/choose every permission by hand/i).length
      ).toBeGreaterThan(0);
    });

    it("renders a combobox", () => {
      render(<RoleInheritanceWrapper />);

      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
  });

  describe("the effect summary", () => {
    it("says what a base role means, in a sentence", () => {
      render(<RoleInheritanceWrapper selectedBaseRoleIds={["r1"]} />);

      expect(
        screen.getByText(/can do everything Editor can/i)
      ).toBeInTheDocument();
    });

    it("counts the permissions ticked on top of the base", () => {
      render(
        <RoleInheritanceWrapper
          selectedBaseRoleIds={["r1"]}
          lockedPermissionIds={["p1", "p2"]}
          defaultValues={{ permissions: ["p1", "p2", "extra-1", "extra-2"] }}
        />
      );

      expect(screen.getByText(/plus 2 permissions/i)).toBeInTheDocument();
    });

    it("counts one extra without pluralising it", () => {
      render(
        <RoleInheritanceWrapper
          selectedBaseRoleIds={["r1"]}
          lockedPermissionIds={["p1"]}
          defaultValues={{ permissions: ["p1", "extra-1"] }}
        />
      );

      expect(screen.getByText(/plus 1 permission ticked/i)).toBeInTheDocument();
    });

    // A base with nothing added is the plain case, and the sentence should not
    // trail off into "plus 0 permissions".
    it("says nothing about extras when there are none", () => {
      render(
        <RoleInheritanceWrapper
          selectedBaseRoleIds={["r1"]}
          lockedPermissionIds={["p1"]}
          defaultValues={{ permissions: ["p1"] }}
        />
      );

      expect(
        screen.getByText(/can do everything Editor can\./i)
      ).toBeInTheDocument();
      expect(screen.queryByText(/plus 0/)).not.toBeInTheDocument();
    });

    it("explains the choice when there is no base", () => {
      render(<RoleInheritanceWrapper />);

      expect(screen.getByText(/Pick a role to build on/i)).toBeInTheDocument();
    });

    it("survives a base role that is no longer in the list", () => {
      render(<RoleInheritanceWrapper selectedBaseRoleIds={["gone"]} />);

      // Falls back to the no-base copy rather than naming a role it cannot find.
      expect(screen.getByText(/Pick a role to build on/i)).toBeInTheDocument();
    });
  });
});
