/**
 * Create on the field group create page makes the field group a pending
 * change: it waits in this tab's unsaved entities, and its editor opens.
 * Nothing is created on the server until the editor's save.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type { UnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import type { FieldDefinition } from "@admin/types/collection";

let submit:
  | ((
      values: BuilderSettingsValues,
      templateFields: FieldDefinition[],
      needed: Omit<UnsavedEntity, "token">[]
    ) => void)
  | undefined;
vi.mock(
  "@admin/components/features/schema-builder/new-entity/NewEntityDialog",
  () => ({
    NewEntityDialog: (props: {
      onCreate: (
        values: BuilderSettingsValues,
        templateFields: FieldDefinition[],
        needed: Omit<UnsavedEntity, "token">[]
      ) => void;
    }) => {
      submit = props.onCreate;
      return null;
    },
  })
);

const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries/useFieldGroups", () => ({
  useCreateFieldGroup: () => ({ mutate: mockCreate, isPending: false }),
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

import FieldGroupBuilderPage from "../index";

const VALUES = {
  singularName: "Hero banner",
  slug: "hero_banner",
  icon: "",
  category: "Layout",
} as BuilderSettingsValues;

beforeEach(() => {
  vi.clearAllMocks();
  submit = undefined;
});

afterEach(() => removeUnsavedEntity("field-group", "hero_banner"));

describe("Field group create page", () => {
  it("keeps the field group unsaved, with no fields yet", () => {
    render(<FieldGroupBuilderPage />);
    submit?.(VALUES, [], []);

    expect(unsavedEntity("field-group", "hero_banner")).toEqual({
      // The store gives each entity a token of its own.
      token: expect.any(String),
      kind: "field-group",
      address: "hero_banner",
      settings: expect.objectContaining({
        singularName: "Hero banner",
        slug: "hero_banner",
        category: "Layout",
      }),
      fields: [],
    });
  });

  it("keeps a template's fields as its fields", () => {
    render(<FieldGroupBuilderPage />);
    submit?.(VALUES, [{ name: "street", type: "text" }], []);

    expect(unsavedEntity("field-group", "hero_banner")?.fields).toEqual([
      { name: "street", type: "text" },
    ]);
  });

  it("creates nothing on the server, and opens the field group's editor", () => {
    render(<FieldGroupBuilderPage />);
    submit?.(VALUES, [], []);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/admin/builder/field-groups/hero_banner"
    );
  });
});
