/**
 * A Single's save sends a link the editor cannot see as the reference it is.
 *
 * The form holds such a link as a placeholder, at the top level and inside a
 * group, and the save observed here is the one the page sends to the server.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@admin/__tests__/utils";
import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "headline", label: "Headline" },
    {
      type: "relationship",
      name: "featured",
      label: "Featured",
      relationTo: "pages",
      hasMany: true,
    },
    {
      type: "group",
      name: "brand",
      label: "Brand",
      fields: [
        { type: "upload", name: "logo", label: "Logo", relationTo: "media" },
      ],
    },
  ],
} as unknown as SingleSchema;

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  headline: "Hello",
  featured: [
    { id: "p1", title: "Page one" },
    { id: "p2", [RESTRICTED_REFERENCE]: true },
  ],
  brand: { logo: { id: "m1", [RESTRICTED_REFERENCE]: true } },
} as unknown as SingleDocumentData;

describe("SingleForm — links the editor cannot see", () => {
  it("are saved as their references, and stay placeholders in the form", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <TooltipProvider>
        <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
      </TooltipProvider>
    );
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Hello again" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        headline: "Hello again",
        featured: [{ id: "p1", title: "Page one" }, "p2"],
        brand: { logo: "m1" },
      })
    );
    expect(
      screen.getByRole("group", { name: "Restricted or missing item p2" })
    ).toBeTruthy();
  });
});
