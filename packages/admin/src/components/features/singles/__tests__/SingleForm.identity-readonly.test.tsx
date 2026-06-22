import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "title", label: "Title", required: true },
    { type: "text", name: "slug", label: "Slug", required: true, unique: true },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  heroTitle: "",
} as unknown as SingleDocumentData;

describe("SingleForm — read-only identity", () => {
  it("renders title and slug read-only, sourced from the single config", () => {
    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    expect(title.readOnly).toBe(true);
    expect(title.value).toBe("Homepage");

    // slug shown as read-only text (value rendered, possibly also in the
    // sidebar), with no inline editor affordance in the meta strip.
    expect(screen.getAllByText("homepage").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /edit slug/i })
    ).not.toBeInTheDocument();
  });
});
