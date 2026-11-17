/**
 * Create on the Single create page makes the Single a pending change: it waits
 * in this tab's unsaved entities, with the starting field the "What will
 * editors make?" answer names, and its editor opens. Nothing is created on the
 * server until the editor's save.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder";

let submit: ((values: BuilderSettingsValues) => void) | undefined;
vi.mock(
  "@admin/components/features/schema-builder/new-entity/NewEntityDialog",
  () => ({
    NewEntityDialog: (props: {
      onCreate: (values: BuilderSettingsValues) => void;
    }) => {
      submit = props.onCreate;
      return null;
    },
  })
);

const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries", () => ({
  useCreateSingle: () => ({ mutate: mockCreate, isPending: false }),
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

import SingleBuilderPage from "../index";

function values(startingFieldType: string | null): BuilderSettingsValues {
  return {
    singularName: "Home page",
    slug: "home-page",
    icon: "Home",
    status: true,
    startingFieldType,
  } as BuilderSettingsValues;
}

beforeEach(() => {
  vi.clearAllMocks();
  submit = undefined;
});

afterEach(() => removeUnsavedEntity("single", "home-page"));

describe("Single create page", () => {
  it("keeps the Single unsaved, with the starting field its answer names", () => {
    render(<SingleBuilderPage />);
    submit?.(values("blocks"));

    expect(unsavedEntity("single", "home-page")).toEqual({
      // The store gives each entity a token of its own.
      token: expect.any(String),
      kind: "single",
      address: "home-page",
      settings: expect.objectContaining({
        singularName: "Home page",
        slug: "home-page",
        icon: "Home",
        status: true,
      }),
      fields: [{ name: "blocks", type: "blocks" }],
    });
  });

  it("keeps a Single with no starting field for standard fields", () => {
    render(<SingleBuilderPage />);
    submit?.(values(null));

    expect(unsavedEntity("single", "home-page")?.fields).toEqual([]);
  });

  it("creates nothing on the server, and opens the Single's editor", () => {
    render(<SingleBuilderPage />);
    submit?.(values(null));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/admin/builder/singles/home-page"
    );
  });
});
