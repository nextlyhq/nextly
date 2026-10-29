// The three screens a builder page shows instead of the builder. They replaced
// per-page copies, so what is locked here is that each still says what its page
// said: a named heading for the missing-slug case, skeletons rather than an
// empty frame while loading, and the shared page fallback on failure. The
// builder's own empty state, shown once the entity has loaded with no fields,
// is locked here too: it is the one state every kind reaches through the same
// layout, so it is where a kind-blind sentence would show up on all three.
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderKind } from "../builder-config";
import { BuilderPageLayout } from "../BuilderPageLayout";
import {
  BuilderErrorScreen,
  BuilderLoadingScreen,
  BuilderNotFoundScreen,
} from "../BuilderPageStates";
import type { BuilderFieldsApi } from "../types";

describe("BuilderNotFoundScreen", () => {
  it("renders the kind's own heading and body copy", () => {
    render(
      <BuilderNotFoundScreen
        title="Collection Not Found"
        description="No collection slug was provided."
      />
    );
    expect(
      screen.getByRole("heading", { name: "Collection Not Found" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("No collection slug was provided.")
    ).toBeInTheDocument();
  });

  it("is reusable for another builder kind without changing the component", () => {
    render(
      <BuilderNotFoundScreen
        title="Field Group Not Found"
        description="No field group slug was provided."
      />
    );
    expect(
      screen.getByRole("heading", { name: "Field Group Not Found" })
    ).toBeInTheDocument();
  });
});

describe("BuilderLoadingScreen", () => {
  // The header block stands in for the toolbar and the body block for the
  // field rows, so the page does not jump when the entity arrives. Skeletons
  // carry no text, so the count is the only thing to assert on.
  it("renders a header pair over three field rows", () => {
    const { container } = render(<BuilderLoadingScreen />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      5
    );
  });
});

describe("BuilderErrorScreen", () => {
  it("renders the shared page error fallback", () => {
    render(<BuilderErrorScreen />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});

describe("the builder's empty editor", () => {
  // Rendered through the layout, from the config each page builds, so what is
  // checked is the kind the page actually carries rather than a prop a test
  // hands the empty state directly. The exact sentence is matched because the
  // toolbar's breadcrumb also names the kind, and a loose match would pass on
  // that alone. Both the editable and the read-only empty state are covered.
  function renderEmptyEditor(kind: BuilderKind, locked: boolean) {
    const builder: BuilderFieldsApi = {
      fields: [],
      setFields: vi.fn(),
      sensors: [],
      handleDragStart: vi.fn(),
      handleFieldsReorder: vi.fn(),
      handleFieldDelete: vi.fn(),
      handleFieldUpdate: vi.fn(),
      handleNestedFieldAdd: vi.fn(),
      validateFields: vi.fn(() => ({ valid: true })),
    };
    return render(
      <BuilderPageLayout
        config={{
          kind,
          basicsFields: ["singularName", "slug"],
          advancedFields: [],
          toolbar: { previewSchemaChange: kind === "collection" },
          picker: {},
        }}
        builder={builder}
        name="Example"
        locked={locked}
        unsavedCount={0}
        onSave={vi.fn()}
        settings={{ singularName: "Example", slug: "example", icon: "Box" }}
        onSettingsChange={vi.fn()}
        active={{ kind: "none" }}
        onActiveChange={vi.fn()}
        onDuplicateField={vi.fn()}
        onRowDragEnd={vi.fn()}
        isSaving={false}
        savingLabel=""
      />
    );
  }

  it("each kind's empty editor names the kind", () => {
    const cases: ReadonlyArray<[BuilderKind, string]> = [
      ["collection", "collection"],
      ["single", "Single"],
      ["field-group", "field group"],
    ];
    for (const [kind, noun] of cases) {
      for (const locked of [false, true]) {
        const { container, unmount } = renderEmptyEditor(kind, locked);
        const sentence = locked
          ? `This ${noun} has no custom fields.`
          : `This ${noun} has no custom fields yet.`;
        expect(screen.getByText(sentence)).toBeInTheDocument();
        // Field groups are called components in code; that word is never
        // shown to the person editing one.
        expect(container.textContent ?? "").not.toMatch(/component/i);
        unmount();
      }
    }
  });
});
