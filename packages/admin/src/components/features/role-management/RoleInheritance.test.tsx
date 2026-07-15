/**
 * RoleInheritance — one base role, and a sentence saying what that means.
 *
 * The effect summary is the load-bearing part rather than decoration.
 * Inheritance resolves out of sight, and stating the outcome in words is the
 * whole reason it is defensible to have here when the comparable systems chose
 * visible composition instead. A test on the sentence is a test on that.
 */
import userEvent from "@testing-library/user-event";
import { useForm, type UseFormReturn } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";
import { Form } from "@admin/components/ui/form";
import { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import { roleApi } from "@admin/services/roleApi";

import { RoleInheritance } from "./RoleInheritance";

// Aliased, matching the component's own import: a relative specifier resolves
// to a different module id and leaves the real client in place.
vi.mock("@admin/services/roleApi", () => ({
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

let formRef: UseFormReturn<RoleFormValuesType> | undefined;

/** Write permissions the way the matrix does — from outside this component. */
function setPermissions(ids: string[]) {
  formRef?.setValue("permissions", ids, { shouldDirty: true });
}

function currentPermissions(): string[] {
  return formRef?.getValues("permissions") ?? [];
}

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

  // The permission matrix lives outside this component and writes to the same
  // form. Holding the form here lets a test make that write directly, which is
  // what tells apart a value this component subscribes to from one it samples.
  formRef = form;

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

    // jsdom implements neither pointer capture nor scrollIntoView, and the
    // select opens through both. Without these the list never mounts and its
    // options cannot be chosen.
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
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

    it("keeps counting as permissions are ticked after the first", () => {
      // The permission matrix is its own controller and nothing above this
      // component re-renders on a permission change, so a sampled read of the
      // form went stale after the first tick and the count stopped moving.
      render(
        <RoleInheritanceWrapper
          selectedBaseRoleIds={["r1"]}
          lockedPermissionIds={["p1", "p2"]}
          defaultValues={{ permissions: ["p1", "p2", "extra1"] }}
        />
      );

      expect(screen.getByText(/plus 1 permission ticked below/i)).toBeVisible();

      act(() => {
        setPermissions(["p1", "p2", "extra1", "extra2", "extra3"]);
      });

      expect(
        screen.getByText(/plus 3 permissions ticked below/i)
      ).toBeVisible();
    });
  });

  describe("labelling", () => {
    it("names the combobox, so it is not announced anonymously", () => {
      render(<RoleInheritanceWrapper />);

      expect(
        screen.getByRole("combobox", { name: /Start from/i })
      ).toBeVisible();
    });
  });

  describe("choosing a base", () => {
    it("keeps permissions ticked after the first, when the base changes", async () => {
      vi.mocked(roleApi.getRoleById).mockResolvedValue({
        id: "r1",
        permissions: ["p1", "p2"],
      } as never);

      const setLockedPermissionIds = vi.fn();
      render(
        <RoleInheritanceWrapper
          setLockedPermissionIds={setLockedPermissionIds}
          defaultValues={{ permissions: [] }}
        />
      );

      // Everything ticked before a base is chosen must survive choosing one.
      act(() => {
        setPermissions(["extra1", "extra2", "extra3"]);
      });

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByRole("option", { name: "Editor" }));

      await waitFor(() => {
        expect(currentPermissions()).toEqual(
          expect.arrayContaining(["extra1", "extra2", "extra3", "p1", "p2"])
        );
      });
    });

    it("ignores a base whose request lands after a newer one", async () => {
      // The first request is held open until the second has finished, so the
      // out-of-order landing is forced rather than hoped for: a timer would
      // race the several awaits inside userEvent and usually resolve first,
      // which is a test that proves nothing.
      let releaseEditor!: () => void;
      const editorInFlight = new Promise<void>(resolve => {
        releaseEditor = resolve;
      });

      vi.mocked(roleApi.getRoleById).mockImplementation((async (id: string) => {
        if (id === "r1") {
          await editorInFlight;
          return { id: "r1", permissions: ["p1", "p2"] };
        }
        return { id: "r2", permissions: ["p3"] };
      }) as never);

      const setSelectedBaseRoleIds = vi.fn();
      render(
        <RoleInheritanceWrapper
          setSelectedBaseRoleIds={setSelectedBaseRoleIds}
        />
      );

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByRole("option", { name: "Editor" }));
      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByRole("option", { name: "Author" }));

      await waitFor(() => {
        expect(setSelectedBaseRoleIds).toHaveBeenCalledWith(["r2"]);
      });

      // Only now does the older request come back.
      await act(async () => {
        releaseEditor();
        await editorInFlight;
      });

      // The stale Editor response must never have been committed.
      expect(setSelectedBaseRoleIds).not.toHaveBeenCalledWith(["r1"]);
      expect(setSelectedBaseRoleIds).toHaveBeenLastCalledWith(["r2"]);
    });
  });
});
