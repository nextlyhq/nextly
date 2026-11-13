/**
 * The Single editor on a Single created in the dialog and not saved yet: read
 * from this tab, its create and starting field pending, its first save its
 * create (address checked again first), a refusal keeping it unsaved, and
 * Discard all letting it go. Once saved, the editor reads the server's Single
 * afresh, with nothing pending.
 */
import { Toaster } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";
import type { ApiSingle } from "@admin/types/entities";

/** The Single as the server holds it, once created. */
let saved: ApiSingle | undefined;
const useSingleSchema = vi.fn((slug: string | undefined) => ({
  data: slug ? saved : undefined,
  isLoading: false,
  error: null,
}));
const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useSingleSchema: (slug: string | undefined) => useSingleSchema(slug),
  useUpdateSingle: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSingle: () => ({ mutateAsync: mockCreate, isPending: false }),
}));

const check = vi.fn();
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: (...args: unknown[]) => check(...args),
  },
}));

const writeSingle = vi.fn();
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: {
    writeSingle: (...args: unknown[]) => writeSingle(...args),
  },
}));

const navigate = vi.fn();
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  navigateTo: (...args: unknown[]) => navigate(...args),
}));

import {
  addUnsavedEntity,
  removeUnsavedEntity,
  unsavedEntity,
} from "@admin/lib/builder/unsaved-entities";

import SingleBuilderEditPage from "../[slug]";

const HEADLINE = { name: "headline", label: "Headline", type: "text" };

function renderEditor() {
  const user = userEvent.setup();
  render(
    <RestartProvider>
      <SingleBuilderEditPage params={{ slug: "home-page" }} />
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
      name: "Create the Single home-page?",
    })
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = undefined;
  check.mockResolvedValue({
    kind: "single",
    address: "home-page",
    refusal: null,
  });
  mockCreate.mockImplementation(async () => {
    saved = {
      id: "sgl_1",
      slug: "home-page",
      label: "Home page",
      tableName: "single_home_page",
      fields: [{ ...HEADLINE, type: "text" }],
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
      status: true,
    } as ApiSingle;
    return { message: "Single created", data: saved };
  });
  writeSingle.mockResolvedValue(undefined);
  addUnsavedEntity({
    kind: "single",
    address: "home-page",
    settings: {
      singularName: "Home page",
      slug: "home-page",
      icon: "Home",
      status: true,
    },
    fields: [{ ...HEADLINE, type: "text" }],
  });
});

afterEach(() => removeUnsavedEntity("single", "home-page"));

describe("the Single editor on a Single not saved yet", () => {
  it("opens it from this tab, asking the server nothing, with its create and starting field pending", async () => {
    renderEditor();
    expect(await screen.findByTestId("field-row-headline")).toBeVisible();
    expect(useSingleSchema).not.toHaveBeenCalledWith("home-page");
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
  });

  it("saves it by its create, after checking its address again, then reads the saved Single with nothing pending", async () => {
    const user = renderEditor();
    await screen.findByTestId("field-row-headline");
    await saveAndConfirm(user);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith("single", "home-page", []);
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreate.mock.invocationCallOrder[0]
    );
    expect(mockCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        slug: "home-page",
        label: "Home page",
        admin: { icon: "Home" },
        status: true,
        fields: [expect.objectContaining({ name: "headline", type: "text" })],
      })
    );
    await waitFor(() =>
      expect(unsavedEntity("single", "home-page")).toBeUndefined()
    );
    expect(writeSingle).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
  });

  it("keeps it unsaved, creating nothing, when its address was taken meanwhile", async () => {
    check.mockResolvedValue({
      kind: "single",
      address: "home-page",
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
    expect(unsavedEntity("single", "home-page")).toBeDefined();
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

    expect(unsavedEntity("single", "home-page")).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/admin/builder/singles");
  });

  it("offers to open the Page Builder once a Single of designed pages is saved", async () => {
    removeUnsavedEntity("single", "home-page");
    addUnsavedEntity({
      kind: "single",
      address: "home-page",
      settings: { singularName: "Home page", slug: "home-page", icon: "Home" },
      fields: [{ name: "blocks", type: "blocks" }],
    });
    mockCreate.mockImplementation(async () => {
      saved = {
        id: "sgl_1",
        slug: "home-page",
        label: "Home page",
        tableName: "single_home_page",
        fields: [{ name: "blocks", label: "Blocks", type: "blocks" }],
        createdAt: "2026-11-13T00:00:00.000Z",
        updatedAt: "2026-11-13T00:00:00.000Z",
      } as ApiSingle;
      return { message: "Single created", data: saved };
    });
    const user = renderEditor();
    await screen.findByText("2 unsaved changes");
    // Nothing to open while the Single is not saved.
    expect(
      screen.queryByRole("link", { name: "Open the Page Builder" })
    ).toBeNull();
    await saveAndConfirm(user);

    expect(
      await screen.findByRole("link", { name: "Open the Page Builder" })
    ).toHaveAttribute("href", "/admin/singles/home-page");
  });
});
