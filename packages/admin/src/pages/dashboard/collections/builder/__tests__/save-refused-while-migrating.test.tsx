/**
 * A schema apply the server refuses while a migration holds the database
 * answers 503 with its own sentence, and that sentence is what the person who
 * pressed Save reads. The page is drawn with the real restart provider and the
 * real toaster, and the request goes through the real fetcher, so the text
 * asserted is what reaches the screen from the response body.
 */
import { Toaster } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { RestartProvider } from "@admin/context/RestartContext";
import type { Collection } from "@admin/types/collection";

import CollectionBuilderEditPage from "../[slug]";

const MIGRATION_RUNNING =
  "A migration is running on this database, so this change was not saved. Save it again once the migration ends.";

const COLLECTION: Collection = {
  id: "col_posts",
  name: "posts",
  slug: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  tableName: "dc_posts",
  source: "ui",
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

const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/collections/schema/posts/preview")) {
        return Promise.resolve(json(PREVIEW, 200));
      }
      if (url.endsWith("/collections/schema/posts/apply")) {
        return Promise.resolve(
          json(
            {
              error: {
                code: "SERVICE_UNAVAILABLE",
                message: MIGRATION_RUNNING,
                requestId: "r1",
              },
            },
            503
          )
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

describe("Collection builder save refused while a migration runs", () => {
  it("shows the server's sentence when the apply answers 503", async () => {
    const user = userEvent.setup();
    render(
      <RestartProvider>
        <CollectionBuilderEditPage params={{ slug: "posts" }} />
        <Toaster />
      </RestartProvider>
    );

    // A change to save: the field's menu, opened from its row, duplicates it.
    (await screen.findByTestId("field-row-excerpt")).focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(
      await screen.findByRole("menuitem", { name: "Duplicate" })
    );
    await user.click(screen.getByRole("button", { name: /^save/i }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: /apply and restart/i })
    );

    expect(await screen.findByText(MIGRATION_RUNNING)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        requests.filter(url => url.endsWith("/collections/schema/posts/apply"))
      ).toHaveLength(1)
    );
  });
});
