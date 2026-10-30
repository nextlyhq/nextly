/**
 * The "How is this edited?" answer must reach both places a new Single is
 * recorded: the create request (so the server makes the field) and
 * ui-schema.json (so the committed schema agrees). Dropping it left a Single
 * made for the Page Builder with no blocks field, so its editor had nothing
 * for the Page Builder to attach to.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder";

let submit: ((values: BuilderSettingsValues) => void) | undefined;
vi.mock("@admin/components/features/schema-builder", () => ({
  BuilderSettingsModal: (props: {
    onSubmit: (values: BuilderSettingsValues) => void;
  }) => {
    submit = props.onSubmit;
    return null;
  },
}));

const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries", () => ({
  useCreateSingle: () => ({ mutate: mockCreate, isPending: false }),
}));

const mockWriteSingle = vi.fn();
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: {
    writeSingle: (...args: unknown[]) => mockWriteSingle(...args),
  },
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { toast } from "@admin/components/ui";
import { parseApiError } from "@admin/lib/api/parseApiError";

import SingleBuilderPage from "../index";

function values(startingFieldType: string | null): BuilderSettingsValues {
  return {
    singularName: "Homepage",
    startingFieldType,
  } as BuilderSettingsValues;
}

beforeEach(() => {
  vi.clearAllMocks();
  submit = undefined;
  mockWriteSingle.mockResolvedValue(undefined);
});

describe("Single create page", () => {
  it("creates the Single with the starting field its answer names", () => {
    render(<SingleBuilderPage />);
    submit?.(values("blocks"));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].fields).toEqual([
      { name: "blocks", type: "blocks" },
    ]);
  });

  it("writes the same starting field to ui-schema.json", async () => {
    render(<SingleBuilderPage />);
    submit?.(values("blocks"));
    const { onSuccess } = mockCreate.mock.calls[0][1];
    onSuccess();
    await vi.waitFor(() => expect(mockWriteSingle).toHaveBeenCalledTimes(1));

    const entity = mockWriteSingle.mock.calls[0][0];
    expect(entity.fields).toEqual([
      expect.objectContaining({ name: "blocks", type: "blocks" }),
    ]);
  });

  it("creates a Single with no starting field for standard fields", () => {
    render(<SingleBuilderPage />);
    submit?.(values(null));

    expect(mockCreate.mock.calls[0][0].fields).toEqual([]);
  });

  /**
   * A refused address arrives as a validation envelope whose own message is
   * only "Validation failed."; the reason is the field's. Toasting the
   * envelope's message told the person their Single was refused without why.
   */
  it("shows the reason a refused address gives, not the envelope's message", () => {
    const reason =
      "Single address 'home-locales' cannot end in '_locales': that suffix names a localization table";
    render(<SingleBuilderPage />);
    submit?.(values(null));
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
});
