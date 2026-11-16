/**
 * A field group's settings changed in the same save as a field reach the
 * server: the schema apply carries the fields, and a settings write follows it
 * with every setting the modal changed (its name, description, icon and
 * category). Drawn with the real restart provider and fetcher; only the
 * settings write is observed, as the mutation the page calls.
 */
import { Toaster } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";
import type { ApiFieldGroup } from "@admin/types/entities";

import FieldGroupBuilderEditPage from "../[slug]";

const FIELD_GROUP: ApiFieldGroup = {
  id: "fg_hero",
  slug: "hero",
  label: "Hero",
  tableName: "comp_hero",
  source: "ui",
  admin: { category: "Layout" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  fields: [
    {
      name: "heading",
      label: "Heading",
      type: "text",
      required: false,
      unique: false,
      index: false,
    },
  ],
};

const updateFieldGroup = vi.fn();
vi.mock("@admin/hooks/queries/useFieldGroups", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useFieldGroups")
  >()),
  useFieldGroup: () => ({ data: FIELD_GROUP, isLoading: false, error: null }),
  useUpdateFieldGroup: () => ({ mutate: updateFieldGroup, isPending: false }),
}));

// Who uses the field group is asked of the server on its own; not this test's.
vi.mock("@admin/components/features/schema-builder/FieldGroupUsedBy", () => ({
  FieldGroupUsedBy: () => null,
}));

vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { writeFieldGroup: vi.fn(async () => undefined) },
}));

const PREVIEW = {
  hasChanges: true,
  hasDestructiveChanges: false,
  classification: "safe",
  changes: { added: [], removed: [], changed: [], unchanged: [] },
  warnings: [],
  interactiveFields: [],
  ddlPreview: [],
  schemaVersion: 4,
  renamed: [],
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const applied: unknown[] = [];
/** Whether the server's preview finds fields to migrate. */
let previewFindsChanges = true;

beforeEach(() => {
  updateFieldGroup.mockClear();
  applied.length = 0;
  previewFindsChanges = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/field-groups/schema/hero/preview")) {
        return Promise.resolve(
          json({ ...PREVIEW, hasChanges: previewFindsChanges }, 200)
        );
      }
      if (url.endsWith("/field-groups/hero/used-by")) {
        return Promise.resolve(
          json(
            {
              items: [
                {
                  entityType: "collection",
                  entitySlug: "pages",
                  fieldPath: "hero",
                },
                // A second placement in the same collection: still one place.
                {
                  entityType: "collection",
                  entitySlug: "pages",
                  fieldPath: "footer",
                },
                {
                  entityType: "single",
                  entitySlug: "home",
                  fieldPath: "banner",
                },
              ],
              meta: { total: 3 },
            },
            200
          )
        );
      }
      if (url.endsWith("/field-groups/schema/hero/apply")) {
        applied.push(JSON.parse(String(init?.body ?? "{}")));
        return Promise.resolve(
          json({ message: "Applied", newSchemaVersion: 5 }, 200)
        );
      }
      return Promise.resolve(
        json(
          {
            error: {
              code: "NOT_FOUND",
              message: `No stub for ${url}`,
              requestId: "stub",
            },
          },
          404
        )
      );
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a field group's settings saved with a field change", () => {
  it("sends the name, description, icon and category, after the fields are applied", async () => {
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <FieldGroupBuilderEditPage params={{ slug: "hero" }} />
        <Toaster />
      </RestartProvider>
    );

    // A field change: the field's menu, opened from its row, duplicates it.
    (await screen.findByTestId("field-row-heading")).focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(
      await screen.findByRole("menuitem", { name: "Duplicate" })
    );

    // A settings change: a new name, description and icon.
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("dialog");
    const name = within(settings).getByLabelText("Singular name");
    await user.clear(name);
    await user.type(name, "Banner");
    await user.type(within(settings).getByLabelText("Description"), "Top");
    await user.click(
      // The icon picker, named by the icon it holds (a field group's
      // default, "Puzzle").
      within(settings).getByRole("button", { name: "Puzzle" })
    );
    await user.type(screen.getByPlaceholderText(/search icons/i), "Star");
    await user.click(screen.getByTitle("Star"));
    await user.click(within(settings).getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: /^save/i }));
    const review = await screen.findByRole("alertdialog");
    await user.click(
      within(review).getByRole("button", { name: /apply and restart/i })
    );

    await waitFor(() => expect(applied).toHaveLength(1));
    await waitFor(() => expect(updateFieldGroup).toHaveBeenCalledTimes(1));
    const [{ fieldGroupSlug, updates }] = updateFieldGroup.mock.calls[0];
    expect(fieldGroupSlug).toBe("hero");
    expect(updates).toEqual(
      expect.objectContaining({
        label: "Banner",
        description: "Top",
        admin: expect.objectContaining({ icon: "Star", category: "Layout" }),
      })
    );
    // The fields went with the apply; this write carries settings only.
    expect(updates).not.toHaveProperty("fields");
  });
});

describe("a field group's settings saved on their own", () => {
  it("are reviewed first, then saved without a schema apply", async () => {
    // No field changed, so the server's preview finds nothing to migrate.
    previewFindsChanges = false;
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <FieldGroupBuilderEditPage params={{ slug: "hero" }} />
        <Toaster />
      </RestartProvider>
    );
    await screen.findByTestId("field-row-heading");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("dialog");
    await user.type(within(settings).getByLabelText("Description"), "Top");
    await user.click(within(settings).getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: /^save/i }));
    const review = await screen.findByRole("alertdialog");
    expect(
      within(review).getByRole("heading", {
        name: "Save the settings of the field group hero?",
      })
    ).toBeInTheDocument();
    expect(
      within(within(review).getByRole("list", { name: "Settings" }))
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Description: none → Top"]);
    // Nothing is written until the review is confirmed.
    expect(updateFieldGroup).not.toHaveBeenCalled();

    await user.click(within(review).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateFieldGroup).toHaveBeenCalledTimes(1));
    expect(updateFieldGroup.mock.calls[0][0].updates).toEqual(
      expect.objectContaining({ description: "Top" })
    );
    expect(applied).toHaveLength(0);
  });
});

describe("a saved field group's address", () => {
  it("is fixed, saying the fields that use it refer to it, and how many", async () => {
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <FieldGroupBuilderEditPage params={{ slug: "hero" }} />
        <Toaster />
      </RestartProvider>
    );
    await screen.findByTestId("field-row-heading");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("dialog");
    const address = within(settings).getByLabelText("Slug");
    expect(address).toHaveAttribute("readonly");
    await waitFor(() =>
      expect(address).toHaveAccessibleDescription(
        "Fixed once saved: the fields that use this field group refer to it by this address. Used in 2 places you can read."
      )
    );
  });
});
