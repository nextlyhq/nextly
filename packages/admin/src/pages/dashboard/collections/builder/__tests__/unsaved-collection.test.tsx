/**
 * The collection editor on a collection created in the dialog and not saved
 * yet. Nothing of it is on the server, so the editor reads it from this tab's
 * unsaved entities, counts its create and its starting field as pending, and
 * its first save is its create: reviewed as what will be created, its address
 * checked again, then the create sent with every field and setting. A refused
 * save keeps it unsaved; Discard all lets it go.
 */
import { Toaster } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";

const useCollection = vi.fn((_slug: string | undefined) => ({
  data: undefined,
  isLoading: false,
  error: null,
}));
const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollection: (slug: string | undefined) => useCollection(slug),
  useUpdateCollection: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCollection: () => ({ mutateAsync: mockCreate, isPending: false }),
}));

const check = vi.fn();
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: (...args: unknown[]) => check(...args),
  },
}));

const writeCollection = vi.fn();
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: {
    writeCollection: (...args: unknown[]) => writeCollection(...args),
  },
}));

// Watched, and still made: the leave guard sees the navigation as it would.
const navigate = vi.fn();
vi.mock("@admin/lib/navigation", async importOriginal => {
  const actual = await importOriginal<typeof import("@admin/lib/navigation")>();
  return {
    ...actual,
    navigateTo: (path: string) => {
      navigate(path);
      actual.navigateTo(path);
    },
  };
});

import { parseApiError } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import {
  addUnsavedEntity,
  removeUnsavedEntity,
  unsavedEntity,
} from "@admin/lib/builder/unsaved-entities";

import CollectionBuilderEditPage from "../[slug]";

function renderEditor() {
  const user = userEvent.setup();
  render(
    <RestartProvider>
      <CollectionBuilderEditPage params={{ slug: "products" }} />
      <Toaster />
    </RestartProvider>
  );
  return user;
}

async function saveAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^save/i }));
  const dialog = await screen.findByRole("alertdialog");
  expect(
    within(dialog).getByRole("heading", {
      name: "Create the collection products?",
    })
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/admin/builder/collections/products");
  check.mockResolvedValue({
    kind: "collection",
    address: "products",
    refusal: null,
  });
  mockCreate.mockResolvedValue({ message: "Collection created" });
  writeCollection.mockResolvedValue(undefined);
  addUnsavedEntity({
    kind: "collection",
    address: "products",
    settings: {
      singularName: "Product",
      pluralName: "Products",
      slug: "products",
      icon: "Package",
      versions: true,
    },
    fields: [{ name: "headline", label: "Headline", type: "text" }],
  });
});

afterEach(() => removeUnsavedEntity("collection", "products"));

describe("the collection editor on a collection not saved yet", () => {
  it("opens it from this tab, asking the server nothing, with its create and starting field pending", async () => {
    renderEditor();
    expect(await screen.findByTestId("field-row-headline")).toBeVisible();
    expect(useCollection).not.toHaveBeenCalledWith("products");
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
  });

  it("saves it by its create, after checking its address again, and lets it go from this tab", async () => {
    const user = renderEditor();
    await screen.findByTestId("field-row-headline");
    await saveAndConfirm(user);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith("collection", "products", []);
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreate.mock.invocationCallOrder[0]
    );
    expect(mockCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: "products",
        labels: { singular: "Product", plural: "Products" },
        icon: "Package",
        versions: true,
        fields: [expect.objectContaining({ name: "headline", type: "text" })],
      })
    );
    await waitFor(() =>
      expect(unsavedEntity("collection", "products")).toBeUndefined()
    );
    expect(writeCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [expect.objectContaining({ name: "headline" })],
      })
    );
  });

  it("keeps it unsaved, creating nothing, when its address was taken meanwhile", async () => {
    check.mockResolvedValue({
      kind: "collection",
      address: "products",
      refusal: { code: "DUPLICATE", message: "Resource already exists." },
    });
    const user = renderEditor();
    await screen.findByTestId("field-row-headline");
    await saveAndConfirm(user);

    expect(
      await screen.findByText(
        "A collection or Single already uses this address."
      )
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(unsavedEntity("collection", "products")).toBeDefined();
  });

  it("keeps it unsaved, with the create's reason, when the server refuses the create", async () => {
    const reason = "Two fields are both named 'headline'.";
    mockCreate.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            data: { errors: [{ path: "fields", message: reason }] },
          },
        },
        400
      )
    );
    const user = renderEditor();
    await screen.findByTestId("field-row-headline");
    await saveAndConfirm(user);

    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(unsavedEntity("collection", "products")).toBeDefined();
    expect(writeCollection).not.toHaveBeenCalled();
  });

  it("lets it go, and returns to the list, on Discard all", async () => {
    const user = renderEditor();
    await screen.findByTestId("field-row-headline");
    await user.click(
      screen.getByRole("button", { name: "Discard all changes" })
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: /^Discard/,
      })
    );

    expect(unsavedEntity("collection", "products")).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/admin/builder/collections");
    // Discarding was the answer to the guard's question, so it is not asked.
    expect(window.location.pathname).toBe("/admin/builder/collections");
    expect(
      screen.queryByRole("alertdialog", { name: "Unsaved Changes" })
    ).toBeNull();
  });

  it("lets it go when the editor is left and its changes discarded", async () => {
    const user = renderEditor();
    await screen.findByTestId("field-row-headline");
    navigateTo("/admin/builder/singles");
    const guard = await screen.findByRole("alertdialog", {
      name: "Unsaved Changes",
    });
    await user.click(
      within(guard).getByRole("button", { name: "Discard Changes" })
    );

    await waitFor(() =>
      expect(unsavedEntity("collection", "products")).toBeUndefined()
    );
  });
});
