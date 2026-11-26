/**
 * The field-group dialog both Builder pickers mount (adding a field, changing a field's type) is
 * keyed afresh for each "New field group". A key spread among its props is no key: React warns,
 * and the dev overlay counts it an issue. React warns once for each component, so this file renders
 * the pickers before anything else has.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";

import { BuilderChangeType } from "../BuilderChangeType";
import { BuilderFieldPicker } from "../BuilderFieldPicker";
import type { BuilderField } from "../types";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
}));

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useFieldGroups: () => ({ data: { items: [] }, isLoading: false }),
}));

/** No address is used: the dialog asks of the one typed. */
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: async (of: string, address: string) => ({
      kind: of,
      address,
      refusal: null,
    }),
  },
}));

const kind: BuilderField = {
  id: "f-kind",
  name: "kind",
  label: "Kind",
  type: "text",
};

describe("the Builder's pickers and their field-group dialog", () => {
  it("mount it keyed, with no key spread among its props", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <BuilderFieldPicker
          config={COLLECTION_BUILDER_CONFIG}
          fields={[kind]}
          position={{}}
          onCancel={vi.fn()}
          onFieldsChange={vi.fn()}
          onAdded={vi.fn()}
        />
      );
      render(
        <BuilderChangeType
          config={COLLECTION_BUILDER_CONFIG}
          fields={[kind]}
          fieldId="f-kind"
          onCancel={vi.fn()}
          onChanged={vi.fn()}
        />
      );
      const spread = logged.mock.calls.filter(call =>
        String(call[0]).includes('"key" prop is being spread')
      );
      expect(spread).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  // The add picker's own is held beside its other cases (`FieldPicker.test.tsx`).
  it("open it fresh from Change type… each time, never with a cancelled one's values", async () => {
    const user = userEvent.setup();
    render(
      <BuilderChangeType
        config={COLLECTION_BUILDER_CONFIG}
        fields={[kind]}
        fieldId="f-kind"
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    const openDialog = async () => {
      await user.click(screen.getByRole("button", { name: "New field group" }));
      return screen.findByRole("dialog", { name: "New field group" });
    };
    await user.click(screen.getByRole("option", { name: /Field group/ }));
    const first = await openDialog();
    await user.type(
      within(first).getByRole("textbox", { name: "Name" }),
      "Draft"
    );
    expect(within(first).getByRole("textbox", { name: "Name" })).toHaveValue(
      "Draft"
    );
    await user.click(within(first).getByRole("button", { name: "Cancel" }));

    const second = await openDialog();
    expect(within(second).getByRole("textbox", { name: "Name" })).toHaveValue(
      ""
    );
  });
});
