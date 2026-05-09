import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { Form } from "@admin/components/ui/form";
import { RoleFormValuesType } from "@admin/hooks/useRoleForm";

import { RoleBasicInfo } from "./RoleBasicInfo";

// Wrapper component to provide form context
function RoleBasicInfoWrapper({
  defaultValues,
  isEditMode = false,
  isSystemRole = false,
  isLoading = false,
  onNameChange = vi.fn(),
}: {
  defaultValues?: Partial<RoleFormValuesType>;
  isEditMode?: boolean;
  isSystemRole?: boolean;
  isLoading?: boolean;
  onNameChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
        <RoleBasicInfo
          form={form}
          isEditMode={isEditMode}
          isSystemRole={isSystemRole}
          isLoading={isLoading}
          handleNameChange={onNameChange}
        />
      </form>
    </Form>
  );
}

describe("RoleBasicInfo", () => {
  describe("Rendering", () => {
    it("renders all three fields: name, slug, and description", () => {
      render(<RoleBasicInfoWrapper />);

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });

    it("renders with default values", () => {
      render(
        <RoleBasicInfoWrapper
          defaultValues={{
            name: "Editor",
            slug: "editor",
            description: "Can edit content",
          }}
        />
      );

      expect(screen.getByDisplayValue("Editor")).toBeInTheDocument();
      expect(screen.getByDisplayValue("editor")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Can edit content")).toBeInTheDocument();
    });

    it("shows correct placeholders", () => {
      render(<RoleBasicInfoWrapper />);

      expect(screen.getByPlaceholderText("Role name")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("role-slug")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Enter a description for this role")
      ).toBeInTheDocument();
    });

    it("shows form descriptions", () => {
      render(<RoleBasicInfoWrapper />);

      expect(
        screen.getByText(/descriptive name for this role/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/URL-friendly identifier/i)).toBeInTheDocument();
      expect(
        screen.getByText(/brief description of this role/i)
      ).toBeInTheDocument();
    });
  });

  describe("Field Interaction", () => {
    it("allows typing in name field", async () => {
      const user = userEvent.setup();
      render(<RoleBasicInfoWrapper />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, "Content Manager");

      expect(screen.getByDisplayValue("Content Manager")).toBeInTheDocument();
    });

    it("allows typing in slug field", async () => {
      const user = userEvent.setup();
      render(<RoleBasicInfoWrapper />);

      const slugInput = screen.getByLabelText(/slug/i);
      await user.type(slugInput, "content-manager");

      expect(screen.getByDisplayValue("content-manager")).toBeInTheDocument();
    });

    it("allows typing in description field", async () => {
      const user = userEvent.setup();
      render(<RoleBasicInfoWrapper />);

      const descInput = screen.getByLabelText(/description/i);
      await user.type(descInput, "Manages all content");

      expect(
        screen.getByDisplayValue("Manages all content")
      ).toBeInTheDocument();
    });

    it("calls handleNameChange when name field changes", async () => {
      const handleNameChange = vi.fn();
      const user = userEvent.setup();
      render(<RoleBasicInfoWrapper onNameChange={handleNameChange} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, "Test");

      expect(handleNameChange).toHaveBeenCalledTimes(4); // Once per character
    });
  });

  describe("System Role Behavior", () => {
    it("disables name field for system roles", () => {
      render(<RoleBasicInfoWrapper isSystemRole={true} />);

      const nameInput = screen.getByLabelText(/name/i);
      expect(nameInput).toBeDisabled();
    });

    it("disables slug field for system roles", () => {
      render(<RoleBasicInfoWrapper isSystemRole={true} />);

      const slugInput = screen.getByLabelText(/slug/i);
      expect(slugInput).toBeDisabled();
    });

    it("does not disable description field for system roles", () => {
      render(<RoleBasicInfoWrapper isSystemRole={true} />);

      const descInput = screen.getByLabelText(/description/i);
      expect(descInput).not.toBeDisabled();
    });

    it("shows system role message in field descriptions", () => {
      render(<RoleBasicInfoWrapper isSystemRole={true} />);

      const messages = screen.getAllByText(
        /cannot be changed for system roles/i
      );
      expect(messages).toHaveLength(2); // Name and slug fields both show this message
    });
  });

  describe("Loading State", () => {
    it("disables all fields when loading", () => {
      render(<RoleBasicInfoWrapper isLoading={true} />);

      expect(screen.getByLabelText(/name/i)).toBeDisabled();
      expect(screen.getByLabelText(/slug/i)).toBeDisabled();
      expect(screen.getByLabelText(/description/i)).toBeDisabled();
    });

    it("disables name and slug but not description when loading and system role", () => {
      render(<RoleBasicInfoWrapper isLoading={true} isSystemRole={true} />);

      expect(screen.getByLabelText(/name/i)).toBeDisabled();
      expect(screen.getByLabelText(/slug/i)).toBeDisabled();
      expect(screen.getByLabelText(/description/i)).toBeDisabled();
    });
  });

  describe("Accessibility", () => {
    it("has required attribute on name field", () => {
      render(<RoleBasicInfoWrapper />);

      const nameInput = screen.getByLabelText(/name/i);
      expect(nameInput).toHaveAttribute("aria-required", "true");
    });

    it("has required attribute on slug field", () => {
      render(<RoleBasicInfoWrapper />);

      const slugInput = screen.getByLabelText(/slug/i);
      expect(slugInput).toHaveAttribute("aria-required", "true");
    });

    it("has proper label associations", () => {
      render(<RoleBasicInfoWrapper />);

      const nameInput = screen.getByLabelText(/name/i);
      const slugInput = screen.getByLabelText(/slug/i);
      const descInput = screen.getByLabelText(/description/i);

      expect(nameInput).toHaveAttribute("id", "name");
      expect(slugInput).toHaveAttribute("id", "slug");
      expect(descInput).toHaveAttribute("id", "description");
    });
  });
});
