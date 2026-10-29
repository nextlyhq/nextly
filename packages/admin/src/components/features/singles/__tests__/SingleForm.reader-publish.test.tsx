/**
 * A user who may read a Single and publish it, but not change it, opens it
 * read-only with a working Publish: the write names the status alone, which
 * the publish permission judges, and none of the Single's content.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => "refused",
}));
// May read, publish and unpublish the Single; nothing else.
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) =>
    ["read-homepage", "publish-homepage", "unpublish-homepage"].includes(slug),
}));

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  status: true,
  fields: [{ type: "text", name: "heroTitle", label: "Hero Title" }],
} as unknown as SingleSchema;

const draft = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  heroTitle: "Welcome",
  status: "draft",
} as unknown as SingleDocumentData;

describe("a Single for a user who may publish it but not change it", () => {
  it("publishes with the status alone", async () => {
    const onSubmit = vi.fn(async () => ({ ...draft, status: "published" }));
    render(<SingleForm schema={schema} document={draft} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ status: "published" });
  });

  it("unpublishes with the status alone", async () => {
    const published = { ...draft, status: "published" } as SingleDocumentData;
    const onSubmit = vi.fn(async () => ({ ...draft }));
    render(
      <SingleForm schema={schema} document={published} onSubmit={onSubmit} />
    );

    // Unpublish sits in the document's menu, behind a confirmation.
    await userEvent.click(
      screen.getByRole("button", { name: /more actions|document actions/i })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Unpublish" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Unpublish" })
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ status: "draft" });
  });
});
