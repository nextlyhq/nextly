/**
 * The "How is this edited?" answer must reach both places a new collection is
 * recorded: the create request (so the server makes the field) and
 * ui-schema.json (so the committed schema agrees). The file was written with
 * no fields, so it missed the blocks field the server had just created.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";

let submit: ((values: BuilderSettingsValues) => void) | undefined;
vi.mock(
  "@admin/components/features/schema-builder/BuilderSettingsModal",
  () => ({
    BuilderSettingsModal: (props: {
      onSubmit: (values: BuilderSettingsValues) => void;
    }) => {
      submit = props.onSubmit;
      return null;
    },
  })
);

const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries", () => ({
  useCreateCollection: () => ({ mutate: mockCreate, isPending: false }),
}));

const mockWriteCollection = vi.fn();
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: {
    writeCollection: (...args: unknown[]) => mockWriteCollection(...args),
  },
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { toast } from "@admin/components/ui";
import { parseApiError } from "@admin/lib/api/parseApiError";

import CollectionBuilderPage from "../index";

function values(startingFieldType: string | null): BuilderSettingsValues {
  return {
    singularName: "Post",
    startingFieldType,
  } as BuilderSettingsValues;
}

beforeEach(() => {
  vi.clearAllMocks();
  submit = undefined;
  mockWriteCollection.mockResolvedValue(undefined);
});

describe("Collection create page", () => {
  it("creates the collection with the starting field its answer names", () => {
    render(<CollectionBuilderPage />);
    submit?.(values("blocks"));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].fields).toEqual([
      { name: "blocks", type: "blocks" },
    ]);
  });

  it("writes the same starting field to ui-schema.json", async () => {
    render(<CollectionBuilderPage />);
    submit?.(values("blocks"));
    const { onSuccess } = mockCreate.mock.calls[0][1];
    onSuccess();
    await vi.waitFor(() =>
      expect(mockWriteCollection).toHaveBeenCalledTimes(1)
    );

    const entity = mockWriteCollection.mock.calls[0][0];
    expect(entity.fields).toEqual([
      expect.objectContaining({ name: "blocks", type: "blocks" }),
    ]);
  });

  it("creates a collection with no starting field for standard fields", () => {
    render(<CollectionBuilderPage />);
    submit?.(values(null));

    expect(mockCreate.mock.calls[0][0].fields).toEqual([]);
  });

  /**
   * A refused address arrives as a validation envelope whose own message is
   * only "Validation failed."; the reason is the field's. Toasting the
   * envelope's message told the person their collection was refused without why.
   */
  it("shows the reason a refused address gives, not the envelope's message", () => {
    const reason =
      "Collection address 'settings' is reserved: it names a Nextly system resource, whose permissions the collection would share";
    render(<CollectionBuilderPage />);
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
