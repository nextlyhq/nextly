/**
 * The field group editor on a field group created in the dialog and not saved
 * yet: read from this tab with its create pending and nothing asked of the
 * server (not even who uses it, since nothing can yet), its first save its
 * create (address checked again first), a refusal with the create's reason
 * keeping it unsaved, and Discard all letting it go.
 */
import { Toaster } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";

const useFieldGroup = vi.fn((_slug: string | undefined) => ({
  data: undefined,
  isLoading: false,
  error: null,
}));
const mockCreate = vi.fn();
vi.mock("@admin/hooks/queries/useFieldGroups", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useFieldGroups")
  >()),
  useFieldGroup: (slug: string | undefined) => useFieldGroup(slug),
  useUpdateFieldGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateFieldGroup: () => ({ mutateAsync: mockCreate, isPending: false }),
}));

const usedBy = vi.fn();
vi.mock(
  "@admin/components/features/schema-builder/FieldGroupUsedBy",
  async importOriginal => ({
    // The page counts places by the module's own rule; only the view is stood in for.
    ...(await importOriginal<
      typeof import("@admin/components/features/schema-builder/FieldGroupUsedBy")
    >()),
    FieldGroupUsedBy: (props: { slug: string }) => {
      usedBy(props.slug);
      return null;
    },
  })
);

const check = vi.fn();
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: (...args: unknown[]) => check(...args),
  },
}));

const writeFieldGroup = vi.fn();
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: {
    writeFieldGroup: (...args: unknown[]) => writeFieldGroup(...args),
  },
}));

const navigate = vi.fn();
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  navigateTo: (...args: unknown[]) => navigate(...args),
}));

import { parseApiError } from "@admin/lib/api/parseApiError";
import {
  addUnsavedEntity,
  removeUnsavedEntity,
  unsavedEntity,
} from "@admin/lib/builder/unsaved-entities";

import FieldGroupBuilderEditPage from "../[slug]";

function renderEditor() {
  const user = userEvent.setup();
  render(
    <RestartProvider>
      <FieldGroupBuilderEditPage params={{ slug: "hero_banner" }} />
      <Toaster />
    </RestartProvider>
  );
  return user;
}

async function saveAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^save/i }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent(
    "The field group hero_banner will be created, with no fields yet."
  );
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue({
    kind: "fieldGroup",
    address: "hero_banner",
    refusal: null,
  });
  mockCreate.mockResolvedValue({ id: "fg_1", slug: "hero_banner" });
  writeFieldGroup.mockResolvedValue(undefined);
  addUnsavedEntity({
    kind: "field-group",
    address: "hero_banner",
    settings: {
      singularName: "Hero banner",
      slug: "hero_banner",
      icon: "",
      category: "Layout",
    },
    fields: [],
  });
});

afterEach(() => removeUnsavedEntity("field-group", "hero_banner"));

describe("the field group editor on a field group not saved yet", () => {
  it("opens it from this tab, asking the server nothing, with its create pending", async () => {
    renderEditor();
    expect(await screen.findByText("1 unsaved change")).toBeInTheDocument();
    expect(useFieldGroup).not.toHaveBeenCalledWith("hero_banner");
    expect(usedBy).not.toHaveBeenCalled();
  });

  it("saves it by its create, after checking its address again, and lets it go from this tab", async () => {
    const user = renderEditor();
    await screen.findByText("1 unsaved change");
    await saveAndConfirm(user);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith("fieldGroup", "hero_banner", []);
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreate.mock.invocationCallOrder[0]
    );
    expect(mockCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        slug: "hero_banner",
        label: "Hero banner",
        admin: { category: "Layout", icon: "" },
        fields: [],
      })
    );
    await waitFor(() =>
      expect(unsavedEntity("field-group", "hero_banner")).toBeUndefined()
    );
    expect(writeFieldGroup).toHaveBeenCalledTimes(1);
  });

  it("keeps it unsaved, with the create's reason, when the server refuses the create", async () => {
    const reason =
      "Field group address 'hero_banner' is used by another field group's table.";
    mockCreate.mockRejectedValue(
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
    const user = renderEditor();
    await screen.findByText("1 unsaved change");
    await saveAndConfirm(user);

    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(unsavedEntity("field-group", "hero_banner")).toBeDefined();
    expect(writeFieldGroup).not.toHaveBeenCalled();
  });

  it("lets it go, and returns to the list, on Discard all", async () => {
    const user = renderEditor();
    await screen.findByText("1 unsaved change");
    await user.click(
      screen.getByRole("button", { name: "Discard all changes" })
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: /^Discard/,
      })
    );

    expect(unsavedEntity("field-group", "hero_banner")).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/admin/builder/field-groups");
  });
});
