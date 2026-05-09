import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { Form } from "@admin/components/ui/form";
import { RoleFormValuesType } from "@admin/hooks/useRoleForm";

import { RoleInheritance } from "./RoleInheritance";

// Mock the roleApi
vi.mock("../../services/roleApi", () => ({
  roleApi: {
    getRoleById: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Wrapper component to provide form context
function RoleInheritanceWrapper({
  defaultValues,
  allRoles = [
    { id: "r1", name: "Admin", permissions: ["p1", "p2"] },
    { id: "r2", name: "Editor", permissions: ["p3", "p4"] },
  ],
  selectedBaseRoleIds = [],
  setSelectedBaseRoleIds = vi.fn(),
  rolePermissionsMap = {},
  setRolePermissionsMap = vi.fn(),
  lockedPermissionIds = [],
  setLockedPermissionIds = vi.fn(),
}: {
  defaultValues?: Partial<RoleFormValuesType>;
  allRoles?: Array<{ id: string; name: string; permissions: string[] }>;
  selectedBaseRoleIds?: string[];
  setSelectedBaseRoleIds?: (ids: string[]) => void;
  rolePermissionsMap?: Record<string, string[]>;
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
      status: "active",
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
          rolePermissionsMap={rolePermissionsMap}
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

  describe("Rendering", () => {
    it("renders base role selector when roles are available", () => {
      render(<RoleInheritanceWrapper />);

      expect(screen.getByText("Base Role")).toBeInTheDocument();
    });

    it("returns null when no roles are available", () => {
      const { container } = render(<RoleInheritanceWrapper allRoles={[]} />);

      expect(container.querySelector("form")).toBeEmptyDOMElement();
    });

    it("displays placeholder when no role selected", () => {
      render(<RoleInheritanceWrapper />);

      expect(
        screen.getByText("Select base role (optional)")
      ).toBeInTheDocument();
    });

    it("shows description text", () => {
      render(<RoleInheritanceWrapper />);

      expect(
        screen.getByText(/Inherit permissions from existing role/i)
      ).toBeInTheDocument();
    });
  });

  describe("Selected Roles Display", () => {
    it("displays single selected role name", () => {
      const allRoles = [
        { id: "r1", name: "Admin", permissions: ["p1"] },
        { id: "r2", name: "Editor", permissions: ["p2"] },
      ];

      render(
        <RoleInheritanceWrapper
          allRoles={allRoles}
          selectedBaseRoleIds={["r1"]}
        />
      );

      expect(screen.getByText(/Admin/)).toBeInTheDocument();
      expect(screen.getByText("(1 role)")).toBeInTheDocument();
    });

    it("displays multiple selected role names", () => {
      const allRoles = [
        { id: "r1", name: "Admin", permissions: ["p1"] },
        { id: "r2", name: "Editor", permissions: ["p2"] },
      ];

      render(
        <RoleInheritanceWrapper
          allRoles={allRoles}
          selectedBaseRoleIds={["r1", "r2"]}
        />
      );

      // Check for role names separately (they may be in separate elements)
      expect(screen.getByText(/Admin/)).toBeInTheDocument();
      expect(screen.getByText("(2 roles)")).toBeInTheDocument();
    });

    it("handles missing role gracefully", () => {
      const allRoles = [{ id: "r1", name: "Admin", permissions: ["p1"] }];

      // Reference role that doesn't exist
      render(
        <RoleInheritanceWrapper
          allRoles={allRoles}
          selectedBaseRoleIds={["r1", "non-existent"]}
        />
      );

      // Should still render without crashing - just check component renders
      expect(screen.getByText("Base Role")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("has proper form labels", () => {
      render(<RoleInheritanceWrapper />);

      const label = screen.getByText("Base Role");
      expect(label).toBeInTheDocument();
      expect(label.tagName).toBe("LABEL");
    });

    it("renders combobox for selection", () => {
      render(<RoleInheritanceWrapper />);

      const combobox = screen.getByRole("combobox");
      expect(combobox).toBeInTheDocument();
    });

    it("disables combobox when no roles available", () => {
      render(<RoleInheritanceWrapper allRoles={[]} />);

      // Component returns null, so no combobox should exist
      const combobox = screen.queryByRole("combobox");
      expect(combobox).not.toBeInTheDocument();
    });
  });
});
