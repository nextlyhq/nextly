/**
 * A user field declared hidden is not drawn on the user form.
 *
 * This form draws each field's wrapper itself, outside the entry form's
 * renderer, so it is the one place a hidden declaration has to be asked
 * separately. The visible field beside it is the control.
 */
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import type { UserFieldDefinitionRecord } from "@admin/services/userFieldsApi";

import { UserCustomFields } from "./UserCustomFields";

function record(
  name: string,
  label: string,
  pluginOptions: Record<string, unknown> | null
): UserFieldDefinitionRecord {
  return {
    id: name,
    name,
    label,
    type: "text",
    required: false,
    defaultValue: null,
    options: null,
    hasMany: null,
    minLength: null,
    maxLength: null,
    minValue: null,
    maxValue: null,
    placeholder: null,
    description: null,
    pluginOptions,
    sortOrder: 0,
    source: "ui",
    isActive: true,
    createdAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
  } as UserFieldDefinitionRecord;
}

/** The project's user fields, as the hook answers for the test in hand. */
let fields: UserFieldDefinitionRecord[] = [];

vi.mock("@admin/hooks/queries/useUserFields", () => ({
  useUserFields: () => ({ data: { fields }, isLoading: false, isError: false }),
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

function Form() {
  const { control } = useForm();
  return <UserCustomFields control={control} errors={{}} />;
}

describe("UserCustomFields", () => {
  it("does not draw a field declared hidden, and draws the one beside it", () => {
    fields = [
      record("phone", "Phone", null),
      record("internal", "Internal note", { admin: { hidden: true } }),
    ];
    render(<Form />);
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(screen.queryByLabelText("Internal note")).toBeNull();
    expect(screen.queryByText("Internal note")).toBeNull();
  });

  it("draws no section when every field is hidden", () => {
    // Not a heading over an empty grid. The visible case above is what this
    // is measured against: the same form with a field to draw has a heading.
    fields = [record("internal", "Internal note", { admin: { hidden: true } })];
    render(<Form />);
    expect(
      screen.queryByRole("heading", { name: "Additional Information" })
    ).toBeNull();
  });

  it("draws the section heading when a field is shown", () => {
    fields = [record("phone", "Phone", null)];
    render(<Form />);
    expect(
      screen.getByRole("heading", { name: "Additional Information" })
    ).toBeInTheDocument();
  });
});
