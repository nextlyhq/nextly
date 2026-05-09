import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { Form } from "@admin/components/ui/form";
import { RoleFormValuesType } from "@admin/hooks/useRoleForm";

import { RoleStatusSection } from "./RoleStatusSection";

// Wrapper component to provide form context
function RoleStatusSectionWrapper({
  defaultValues,
  isEditMode = false,
  isSystemRole = false,
  isLoading = false,
  statusOptions = [
    {
      id: "active",
      name: "Active",
      description: "Role is active and can be assigned to users",
    },
    {
      id: "inactive",
      name: "Inactive",
      description: "Role is inactive and cannot be assigned to new users",
    },
    {
      id: "deprecated",
      name: "Deprecated",
      description: "Role is deprecated and will be removed in the future",
    },
  ],
}: {
  defaultValues?: Partial<RoleFormValuesType>;
  isEditMode?: boolean;
  isSystemRole?: boolean;
  isLoading?: boolean;
  statusOptions?: Array<{ id: string; name: string; description: string }>;
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
        <RoleStatusSection
          form={form}
          isLoading={isLoading}
          isSystemRole={isSystemRole}
          isEditMode={isEditMode}
          statusOptions={statusOptions}
        />
      </form>
    </Form>
  );
}

describe("RoleStatusSection", () => {
  describe("Visibility", () => {
    it("renders in create mode for non-system roles", () => {
      render(
        <RoleStatusSectionWrapper isEditMode={false} isSystemRole={false} />
      );

      expect(screen.getByText("Status")).toBeInTheDocument();
    });

    it("does not render in edit mode", () => {
      render(
        <RoleStatusSectionWrapper isEditMode={true} isSystemRole={false} />
      );

      expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    });

    it("does not render for system roles", () => {
      render(
        <RoleStatusSectionWrapper isEditMode={false} isSystemRole={true} />
      );

      expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    });

    it("does not render in edit mode for system roles", () => {
      render(
        <RoleStatusSectionWrapper isEditMode={true} isSystemRole={true} />
      );

      expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    });
  });

  describe("Status Options Rendering", () => {
    it("renders all status options", () => {
      render(<RoleStatusSectionWrapper />);

      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByText("Inactive")).toBeInTheDocument();
      expect(screen.getByText("Deprecated")).toBeInTheDocument();
    });

    it("shows status option descriptions", () => {
      render(<RoleStatusSectionWrapper />);

      expect(
        screen.getByText(/Role is active and can be assigned to users/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Role is inactive and cannot be assigned to new users/i
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Role is deprecated and will be removed/i)
      ).toBeInTheDocument();
    });

    it("renders status options as checkboxes", () => {
      render(<RoleStatusSectionWrapper />);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(3); // One for each status option
    });

    it("checks the default status option", () => {
      render(<RoleStatusSectionWrapper defaultValues={{ status: "active" }} />);

      const activeCheckbox = screen.getByLabelText("Active");
      expect(activeCheckbox).toBeChecked();
    });
  });

  describe("Status Selection", () => {
    it("allows selecting a status option", async () => {
      const user = userEvent.setup();
      render(<RoleStatusSectionWrapper defaultValues={{ status: "active" }} />);

      const inactiveCheckbox = screen.getByLabelText("Inactive");
      await user.click(inactiveCheckbox);

      expect(inactiveCheckbox).toBeChecked();
    });

    it("only one status can be selected at a time", async () => {
      const user = userEvent.setup();
      render(<RoleStatusSectionWrapper defaultValues={{ status: "active" }} />);

      const activeCheckbox = screen.getByLabelText("Active");
      const inactiveCheckbox = screen.getByLabelText("Inactive");

      expect(activeCheckbox).toBeChecked();
      expect(inactiveCheckbox).not.toBeChecked();

      await user.click(inactiveCheckbox);

      expect(activeCheckbox).not.toBeChecked();
      expect(inactiveCheckbox).toBeChecked();
    });
  });

  describe("Loading State", () => {
    it("disables status checkboxes when loading", () => {
      render(<RoleStatusSectionWrapper isLoading={true} />);

      const checkboxes = screen.getAllByRole("checkbox");
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeDisabled();
      });
    });
  });

  describe("Accessibility", () => {
    it("has proper aria-describedby for status options", () => {
      render(<RoleStatusSectionWrapper />);

      const activeCheckbox = screen.getByLabelText("Active");
      expect(activeCheckbox).toHaveAttribute(
        "aria-describedby",
        "status-active-description"
      );
    });

    it("status options have associated descriptions", () => {
      render(<RoleStatusSectionWrapper />);

      const activeDescription = screen
        .getByText(/Role is active and can be assigned to users/i)
        .closest("p");
      expect(activeDescription).toHaveAttribute(
        "id",
        "status-active-description"
      );
    });
  });
});
