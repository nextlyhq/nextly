/**
 * A refused field-group address arrives as a validation envelope whose own
 * message is only "Validation failed."; the reason is the field's. Toasting
 * the envelope's message told the person their field group was refused
 * without why.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder";

let submit: ((values: BuilderSettingsValues) => void) | undefined;
/** What the page last told the dialog about a create on its way. */
let creatingShown: boolean | undefined;
/** Whether the create mutation is on its way. */
let createPending = false;
vi.mock(
  "@admin/components/features/schema-builder/new-entity/NewEntityDialog",
  () => ({
    NewEntityDialog: (props: {
      onCreate: (values: BuilderSettingsValues) => void;
      creating?: boolean;
    }) => {
      submit = props.onCreate;
      creatingShown = props.creating;
      return null;
    },
  })
);

const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries/useFieldGroups", () => ({
  useCreateFieldGroup: () => ({ mutate: mockCreate, isPending: createPending }),
}));

vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { writeFieldGroup: vi.fn() },
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { toast } from "@admin/components/ui";
import { parseApiError } from "@admin/lib/api/parseApiError";

import FieldGroupBuilderPage from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  submit = undefined;
});

describe("Field group create page", () => {
  it("shows the reason a refused address gives, not the envelope's message", () => {
    const reason =
      "Field group address 'field-groups' is reserved: Nextly uses it for a route or a system table";
    render(<FieldGroupBuilderPage />);
    submit?.({ singularName: "Hero" } as BuilderSettingsValues);
    const { onError } = mockCreate.mock.calls[0][1];
    onError(
      parseApiError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            data: { errors: [{ path: "slug", message: reason }] },
          },
        },
        400
      )
    );

    expect(toast.error).toHaveBeenCalledWith(reason);
  });

  it("tells the dialog while a create is on its way, so Create waits for it", () => {
    createPending = true;
    try {
      render(<FieldGroupBuilderPage />);
      expect(creatingShown).toBe(true);
    } finally {
      createPending = false;
    }
  });
});
