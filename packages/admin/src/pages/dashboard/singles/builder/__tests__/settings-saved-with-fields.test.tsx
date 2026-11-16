/**
 * A Single's settings changed in the same save as a field reach the server:
 * the schema apply carries the fields, and the settings write that follows it
 * carries every setting the modal changed, the icon among them. Drawn with the
 * real restart provider and fetcher; only the settings write is observed, as
 * the mutation the page calls.
 */
import { Toaster } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";
import type { ApiSingle } from "@admin/types/entities";

import SingleBuilderEditPage from "../[slug]";

const SINGLE: ApiSingle = {
  id: "single_home",
  slug: "home",
  label: "Home",
  tableName: "single_home",
  source: "ui",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  fields: [
    {
      name: "intro",
      label: "Intro",
      type: "text",
      required: false,
      unique: false,
      index: false,
    },
  ],
};

const updateSingle = vi.fn();
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useSingleSchema: () => ({ data: SINGLE, isLoading: false, error: null }),
  useUpdateSingle: () => ({ mutate: updateSingle, isPending: false }),
}));

vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { writeSingle: vi.fn(async () => undefined) },
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

beforeEach(() => {
  updateSingle.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/singles/schema/home/preview")) {
        return Promise.resolve(json(PREVIEW, 200));
      }
      if (url.endsWith("/singles/schema/home/apply")) {
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

describe("a Single's settings saved with a field change", () => {
  it("sends the icon the settings set, after the fields are applied", async () => {
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <SingleBuilderEditPage params={{ slug: "home" }} />
        <Toaster />
      </RestartProvider>
    );

    // A field change: the field's menu, opened from its row, duplicates it.
    (await screen.findByTestId("field-row-intro")).focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(
      await screen.findByRole("menuitem", { name: "Duplicate" })
    );

    // A settings change: a new icon and a new description.
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("dialog");
    await user.click(
      within(settings).getByRole("button", { name: /select icon/i })
    );
    await user.type(screen.getByPlaceholderText(/search icons/i), "Star");
    await user.click(screen.getByTitle("Star"));
    await user.type(within(settings).getByLabelText("Description"), "Landing");
    await user.click(within(settings).getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: /^save/i }));
    const review = await screen.findByRole("alertdialog");
    await user.click(
      within(review).getByRole("button", { name: /apply and restart/i })
    );

    await waitFor(() => expect(updateSingle).toHaveBeenCalledTimes(1));
    const [{ slug, updates }] = updateSingle.mock.calls[0];
    expect(slug).toBe("home");
    expect(updates).toEqual(
      expect.objectContaining({
        description: "Landing",
        admin: expect.objectContaining({ icon: "Star" }),
      })
    );
    // The fields went with the apply; this write carries settings only.
    expect(updates).not.toHaveProperty("fields");
  });
});
