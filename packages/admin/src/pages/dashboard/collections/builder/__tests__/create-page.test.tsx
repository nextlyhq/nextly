/**
 * Create on the collection create page makes the collection a pending change:
 * it waits in this tab's unsaved entities, with the starting field the "What
 * will editors make?" answer names, and its editor opens. Nothing is created on
 * the server until the editor's save.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type { FieldDefinition } from "@admin/types/collection";

let submit:
  | ((values: BuilderSettingsValues, templateFields: FieldDefinition[]) => void)
  | undefined;
vi.mock(
  "@admin/components/features/schema-builder/new-entity/NewEntityDialog",
  () => ({
    NewEntityDialog: (props: {
      onCreate: (
        values: BuilderSettingsValues,
        templateFields: FieldDefinition[]
      ) => void;
    }) => {
      submit = props.onCreate;
      return null;
    },
  })
);

const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries", () => ({
  useCreateCollection: () => ({ mutate: mockCreate, isPending: false }),
}));

const mockNavigate = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (...args: unknown[]) => mockNavigate(...args),
}));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import {
  removeUnsavedEntity,
  unsavedEntity,
} from "@admin/lib/builder/unsaved-entities";

import CollectionBuilderPage from "../index";

function values(startingFieldType: string | null): BuilderSettingsValues {
  return {
    singularName: "Post",
    slug: "post",
    icon: "FileText",
    startingFieldType,
  } as BuilderSettingsValues;
}

beforeEach(() => {
  vi.clearAllMocks();
  submit = undefined;
});

afterEach(() => removeUnsavedEntity("collection", "post"));

describe("Collection create page", () => {
  it("keeps the collection unsaved, with the starting field its answer names", () => {
    render(<CollectionBuilderPage />);
    submit?.(values("blocks"), []);

    expect(unsavedEntity("collection", "post")).toEqual({
      // The store gives each entity a token of its own.
      token: expect.any(String),
      kind: "collection",
      address: "post",
      settings: expect.objectContaining({
        singularName: "Post",
        pluralName: "Posts",
        slug: "post",
        icon: "FileText",
      }),
      fields: [{ name: "blocks", type: "blocks" }],
    });
  });

  it("keeps a collection with no starting field for standard fields", () => {
    render(<CollectionBuilderPage />);
    submit?.(values(null), []);

    expect(unsavedEntity("collection", "post")?.fields).toEqual([]);
  });

  it("keeps the template's fields after the starting field", () => {
    render(<CollectionBuilderPage />);
    submit?.(values("blocks"), [{ name: "lede", type: "text" }]);

    expect(unsavedEntity("collection", "post")?.fields).toEqual([
      { name: "blocks", type: "blocks" },
      { name: "lede", type: "text" },
    ]);
  });

  it("creates nothing on the server, and opens the collection's editor", () => {
    render(<CollectionBuilderPage />);
    submit?.(values(null), []);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/admin/builder/collections/post"
    );
  });
});
