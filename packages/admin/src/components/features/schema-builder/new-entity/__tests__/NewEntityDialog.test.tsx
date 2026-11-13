/**
 * One short dialog creates a collection, Single or field group: the kind of
 * entries first where the Page Builder is installed, the icon beside the name,
 * the plural and address derived from the name and editable, the address
 * checked by the server's rule as it is typed, and the further options folded
 * under one control that says which are on.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import { FIELD_GROUP_BUILDER_CONFIG } from "@admin/pages/dashboard/field-group/builder/builder-config";
import { SINGLE_BUILDER_CONFIG } from "@admin/pages/dashboard/singles/builder/builder-config";

/** The field types installed plugins offer for entries. */
let pluginEntries: Array<{ type: string; label: string; hint: string }> = [];
vi.mock("@admin/components/field-ui", () => ({
  usePluginFieldTypeEntries: () => pluginEntries,
}));

/** What the server's check refuses, by address. */
let refusals: Record<string, { code: string; message: string }> = {};
const check = vi.fn(async (kind: string, address: string) => ({
  kind,
  address,
  refusal: refusals[address] ?? null,
}));
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: (kind: string, address: string) => check(kind, address),
  },
}));

import type { BuilderConfig } from "../../builder-config";
import { NewEntityDialog } from "../NewEntityDialog";

const PAGE_BUILDER = {
  type: "blocks",
  label: "Blocks",
  hint: "Lay the page out from blocks.",
};

function renderDialog(
  config: BuilderConfig = COLLECTION_BUILDER_CONFIG,
  { creating = false }: { creating?: boolean } = {}
) {
  const onCreate = vi.fn();
  render(
    <NewEntityDialog
      open
      config={config}
      onCancel={vi.fn()}
      onCreate={onCreate}
      creating={creating}
    />
  );
  return { onCreate, user: userEvent.setup() };
}

const nameInput = () => screen.getByLabelText("Name");
const addressInput = () => screen.getByLabelText("API address");
const createButton = () => screen.getByRole("button", { name: "Create" });

beforeEach(() => {
  pluginEntries = [];
  refusals = {};
  check.mockClear();
});

describe("NewEntityDialog", () => {
  it("with and without the Page Builder", async () => {
    renderDialog();
    expect(
      screen.queryByRole("radiogroup", { name: "What will editors make?" })
    ).toBeNull();
  });

  it("asks what editors will make where the Page Builder is installed, and starts pages with its field", async () => {
    pluginEntries = [PAGE_BUILDER];
    const { onCreate, user } = renderDialog();
    const kinds = screen.getByRole("radiogroup", {
      name: "What will editors make?",
    });
    expect(kinds).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Entries with fields/ })
    ).toBeChecked();

    await user.click(
      screen.getByRole("radio", { name: /Pages you design visually/ })
    );
    await user.type(nameInput(), "Landing page");
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ startingFieldType: "blocks" })
    );
  });

  it("suggests an icon", async () => {
    const { user } = renderDialog();
    expect(
      screen.getByRole("button", { name: "Icon: Document" })
    ).toBeVisible();
    await user.type(nameInput(), "Product");
    expect(screen.getByRole("button", { name: "Icon: Package" })).toBeVisible();
  });

  it("searches icons, and keeps the one picked", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /^Icon:/ }));
    await user.type(screen.getByPlaceholderText("Search icons..."), "cart");
    await user.click(screen.getByTitle("Cart"));
    expect(screen.getByRole("button", { name: "Icon: Cart" })).toBeVisible();

    // Picked, so the name no longer chooses it.
    await user.type(nameInput(), "Product");
    expect(screen.getByRole("button", { name: "Icon: Cart" })).toBeVisible();
  });

  it("derives", async () => {
    const { user } = renderDialog();
    await user.type(nameInput(), "Blog post");
    expect(screen.getByLabelText("Plural name")).toHaveValue("Blog posts");
    expect(addressInput()).toHaveValue("blog_post");
  });

  it("edited plural and address", async () => {
    const { user } = renderDialog();
    await user.type(nameInput(), "Person");
    const plural = screen.getByLabelText("Plural name");
    await user.clear(plural);
    await user.type(plural, "Folks");
    await user.clear(addressInput());
    await user.type(addressInput(), "staff");

    // A plural and an address of the person's own stay as they were typed.
    await user.type(nameInput(), "nel");
    expect(plural).toHaveValue("Folks");
    expect(addressInput()).toHaveValue("staff");
  });

  it("empty name", async () => {
    renderDialog();
    expect(createButton()).toBeDisabled();
    expect(createButton()).toHaveAccessibleDescription("Add a name.");
  });

  it("empty plural", async () => {
    const { user } = renderDialog();
    await user.type(nameInput(), "Post");
    await user.clear(screen.getByLabelText("Plural name"));
    expect(createButton()).toBeDisabled();
    expect(createButton()).toHaveAccessibleDescription("Add a plural name.");
  });

  it.each([
    [
      "SLUG_SQL_KEYWORD",
      "Collection address 'select' is a reserved SQL word",
      "select",
      "Collection address 'select' is a reserved SQL word",
    ],
    [
      "DUPLICATE",
      "Resource already exists.",
      "posts",
      "A collection or Single already uses this address.",
    ],
  ])(
    "says the %s refusal beside the address, and keeps Create unavailable",
    async (code, message, address, shown) => {
      refusals = { [address]: { code, message } };
      const { user } = renderDialog();
      await user.type(nameInput(), "Thing");
      await user.clear(addressInput());
      await user.type(addressInput(), address);
      await waitFor(() =>
        expect(addressInput()).toHaveAccessibleDescription(shown)
      );
      expect(createButton()).toBeDisabled();
    }
  );

  it("a derived address from a name of digits only", async () => {
    refusals = {
      "123": {
        code: "SLUG_INVALID_FORMAT",
        message:
          "Collection address '123' must start with a lowercase letter and contain only lowercase letters, numbers, hyphens and underscores",
      },
    };
    const { user } = renderDialog();
    await user.type(nameInput(), "123");
    await waitFor(() =>
      expect(addressInput()).toHaveAccessibleDescription(
        /must start with a lowercase letter/
      )
    );
    expect(createButton()).toBeDisabled();
  });

  it("creates with what it was given, once the address is checked", async () => {
    const { onCreate, user } = renderDialog();
    await user.type(nameInput(), "Product");
    await waitFor(() => expect(createButton()).toBeEnabled());
    expect(check).toHaveBeenLastCalledWith("collection", "product");
    await user.click(createButton());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        singularName: "Product",
        pluralName: "Products",
        slug: "product",
        icon: "Package",
        // Drafts and publishing start on for a kind that has them.
        status: true,
      })
    );
  });

  it("further options", async () => {
    const { user } = renderDialog();
    const options = screen.getByRole("button", { name: /More options/ });
    // The switches on by default are named as on, as they are drawn.
    expect(options).toHaveAccessibleName(
      "More options, on: drafts and publishing, cache revalidation, webhook recording"
    );
    expect(
      screen.queryByRole("switch", { name: "Version history" })
    ).toBeNull();

    await user.click(options);
    await user.click(screen.getByRole("switch", { name: "Version history" }));
    await user.click(screen.getByRole("switch", { name: "Status" }));
    await user.click(screen.getByRole("switch", { name: "Webhook recording" }));
    expect(
      screen.getByRole("button", { name: /More options/ })
    ).toHaveAccessibleName(
      "More options, on: version history, cache revalidation"
    );
  });

  it("a Single", async () => {
    const { user } = renderDialog(SINGLE_BUILDER_CONFIG);
    expect(screen.getByRole("heading", { name: "New Single" })).toBeVisible();
    expect(screen.queryByLabelText("Plural name")).toBeNull();
    await user.type(nameInput(), "Home page");
    expect(addressInput()).toHaveValue("home-page");
    await waitFor(() =>
      expect(check).toHaveBeenLastCalledWith("single", "home-page")
    );
  });

  it("a field group", async () => {
    const { user } = renderDialog(FIELD_GROUP_BUILDER_CONFIG);
    expect(screen.queryByLabelText("Plural name")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Icon:/ })).toBeNull();
    const options = screen.getByRole("button", { name: /More options/ });
    expect(options).toHaveAccessibleName("More options, none on");
    await user.click(options);
    expect(screen.queryByRole("switch", { name: "Status" })).toBeNull();
    await user.type(nameInput(), "Hero banner");
    await waitFor(() =>
      expect(check).toHaveBeenLastCalledWith("fieldGroup", "hero_banner")
    );
  });

  it("checks the address as Create sends it, without surrounding spaces", async () => {
    const { onCreate, user } = renderDialog();
    await user.type(nameInput(), "Thing");
    await user.clear(addressInput());
    await user.type(addressInput(), " posts ");
    await waitFor(() =>
      expect(check).toHaveBeenLastCalledWith("collection", "posts")
    );
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "posts" })
    );
  });

  it("keeps Create unavailable for a blank address, even when the check cannot be asked", async () => {
    check.mockRejectedValue(new Error("network down"));
    const { user } = renderDialog();
    await user.type(nameInput(), "Thing");
    await user.clear(addressInput());
    await user.type(addressInput(), "   ");
    expect(createButton()).toBeDisabled();
    expect(createButton()).toHaveAccessibleDescription("Add an API address.");
  });

  it("creates with the description trimmed, and none for a blank one", async () => {
    const { onCreate, user } = renderDialog();
    await user.type(nameInput(), "Product");
    await user.click(screen.getByRole("button", { name: /More options/ }));
    await user.type(screen.getByLabelText("Description"), "  Shop items  ");
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(onCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: "Shop items" })
    );

    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "   ");
    await user.click(createButton());
    expect(onCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: "" })
    );
  });

  it("starts a Single with drafts and publishing on", async () => {
    const single = renderDialog(SINGLE_BUILDER_CONFIG);
    await single.user.type(nameInput(), "Home");
    await waitFor(() => expect(createButton()).toBeEnabled());
    await single.user.click(createButton());
    expect(single.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: true })
    );
  });

  it("offers Create once while a create is on its way", async () => {
    const { onCreate, user } = renderDialog(COLLECTION_BUILDER_CONFIG, {
      creating: true,
    });
    await user.type(nameInput(), "Product");
    await waitFor(() => expect(check).toHaveBeenCalled());
    const button = screen.getByRole("button", { name: "Creating…" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("says Name and Plural name are required", () => {
    renderDialog();
    expect(nameInput()).toBeRequired();
    expect(screen.getByLabelText("Plural name")).toBeRequired();
  });

  it("scrolls within the viewport when its options are open", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toHaveClass(
      "max-h-[90vh]",
      "overflow-y-auto"
    );
  });
});
