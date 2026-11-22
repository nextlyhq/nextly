/**
 * The Builder judges a new field's name with Draft/Published as the save judges it: on while it is
 * stored on, even after the pending settings turn it off. Its `status` column stands until the save
 * that turns it off lands, after the fields, so the save refuses `status` either way, and the
 * picker gives a field labelled "Status" the next free name instead.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";
import type { Collection } from "@admin/types/collection";

import CollectionBuilderEditPage from "../[slug]";

const COLLECTION: Collection = {
  id: "col_posts",
  name: "posts",
  slug: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  tableName: "dc_posts",
  source: "ui",
  status: true,
  fields: [
    {
      name: "excerpt",
      label: "Excerpt",
      type: "text",
      required: false,
      unique: false,
      index: false,
    },
  ],
};

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollection: () => ({ data: COLLECTION, isLoading: false, error: null }),
  useUpdateCollection: () => ({ mutate: vi.fn(), isPending: false }),
  useFieldGroups: () => ({ data: { items: [], meta: {} }, isLoading: false }),
}));

const pickedName = () =>
  screen.getByText(/^Name:/).querySelector("code")?.textContent;

async function nameForLabel(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.type(
    await screen.findByRole("combobox", { name: "Search field types" }),
    "text"
  );
  await user.click(screen.getByRole("option", { name: /^Text/ }));
  await user.type(screen.getByRole("textbox", { name: "Label" }), label);
  return pickedName();
}

describe("a new field's name, with Draft/Published stored on", () => {
  it("moves past status while drafts are on", async () => {
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <CollectionBuilderEditPage params={{ slug: "posts" }} />
      </RestartProvider>
    );
    await screen.findByTestId("field-row-excerpt");
    expect(await nameForLabel(user, "Status")).toBe("status_2");
  });

  it("still moves past status once the pending settings turn drafts off", async () => {
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <CollectionBuilderEditPage params={{ slug: "posts" }} />
      </RestartProvider>
    );
    await screen.findByTestId("field-row-excerpt");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: /advanced/i }));
    const status = within(dialog).getByRole("switch", { name: /status/i });
    expect(status).toBeChecked();
    await user.click(status);
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    expect(await nameForLabel(user, "Status")).toBe("status_2");
  });
});
