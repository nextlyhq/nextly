/**
 * A Single's schema read says whether a workflow holds its publishing, so a
 * Single with none offers Publish at once, without waiting for a review state
 * to say so; a Single a workflow holds still waits for its review state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

// Who holds the Single, as the reader reads it without claiming it: nobody.
const { lockHolder } = vi.hoisted(() => ({ lockHolder: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/lib/api/protectedApi")>();
  return {
    protectedApi: {
      ...actual.protectedApi,
      get: (path: string, ...rest: unknown[]) =>
        path.startsWith("/document-lock")
          ? lockHolder()
          : (actual.protectedApi.get as (...a: unknown[]) => unknown)(
              path,
              ...rest
            ),
    },
  };
});

// The review state never arrives: whatever is offered is offered without it.
vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: () => new Promise(() => {}),
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => "refused",
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) =>
    ["read-homepage", "publish-homepage", "unpublish-homepage"].includes(slug),
}));

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

function schemaWith(workflow: { slug: string; label: string } | null) {
  return {
    slug: "homepage",
    label: "Homepage",
    status: true,
    fields: [{ type: "text", name: "heroTitle", label: "Hero Title" }],
    workflow,
  } as unknown as SingleSchema;
}

const draft = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  heroTitle: "Welcome",
  status: "draft",
} as unknown as SingleDocumentData;

beforeEach(() => {
  lockHolder.mockReset();
  lockHolder.mockResolvedValue({ holder: null });
});

describe("Publish on a Single, by whether its schema names a workflow", () => {
  it("is offered without a review state where the schema says no workflow holds it", async () => {
    render(
      <SingleForm
        schema={schemaWith(null)}
        document={draft}
        onSubmit={vi.fn()}
      />
    );

    // Once the Single's claim is read; the review state never is.
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toBeEnabled());
  });

  it("waits for the review state where a workflow holds it, which is the control", async () => {
    render(
      <SingleForm
        schema={schemaWith({ slug: "review", label: "Review" })}
        document={draft}
        onSubmit={vi.fn()}
      />
    );

    // Held for the review state, not for the claim: it says so.
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() =>
      expect(publish).toHaveAttribute("title", "Checking the review…")
    );
    expect(publish).toBeDisabled();
  });
});
