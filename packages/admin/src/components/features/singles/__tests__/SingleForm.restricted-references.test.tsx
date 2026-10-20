/**
 * A Single's save sends a link the editor cannot see as the reference it is.
 *
 * The form holds such a link as a placeholder, at the top level and inside a
 * group, and the save observed here is the one the page sends to the server.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { describe, expect, it, vi } from "vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
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

  it("stay placeholders after the save, which the stored document leaves out", async () => {
    // The stored document the host hands back is read as the page's populated
    // read is: the link the editor may not read is not in it.
    const onSubmit = vi.fn(async () => ({
      ...document,
      headline: "Hello again",
      updatedAt: "2026-01-01T00:05:00.000Z",
      featured: [{ id: "p1", title: "Page one" }],
      brand: { logo: null },
    }));
    render(
      <TooltipProvider>
        <SingleForm
          schema={schema}
          document={document}
          onSubmit={onSubmit as never}
        />
      </TooltipProvider>
    );
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Hello again" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // The save lands, and the form takes in what it stored.
    await act(async () => {
      await onSubmit.mock.results[0]?.value;
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(
      screen.getByRole("group", { name: "Restricted or missing item p2" })
    ).toBeTruthy();
  });

  it("are saved as their references inside a field group and a dynamic zone", async () => {
    const cardFields = [
      { type: "text", name: "heading", label: "Heading" },
      {
        type: "relationship",
        name: "pages",
        label: "Pages",
        relationTo: "pages",
        hasMany: true,
      },
    ];
    const zoneSchema = {
      slug: "homepage",
      label: "Homepage",
      fields: [
        { type: "text", name: "headline", label: "Headline" },
        {
          type: "component",
          name: "card",
          label: "Card",
          component: "card",
          componentFields: cardFields,
        },
        {
          type: "component",
          name: "blocks",
          label: "Blocks",
          components: ["card"],
          repeatable: true,
          componentSchemas: { card: { label: "Card", fields: cardFields } },
        },
      ],
    } as unknown as SingleSchema;
    const zoneDocument = {
      id: "homepage",
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: "Homepage",
      slug: "homepage",
      headline: "Hello",
      card: {
        heading: "Card",
        pages: [
          { id: "p1", title: "Page one" },
          { id: "p2", [RESTRICTED_REFERENCE]: true },
        ],
      },
      blocks: [
        {
          _componentType: "card",
          heading: "In a zone",
          pages: [{ id: "p3", [RESTRICTED_REFERENCE]: true }],
        },
      ],
    } as unknown as SingleDocumentData;
    const onSubmit = vi.fn(async () => {});
    render(
      <TooltipProvider>
        <SingleForm
          schema={zoneSchema}
          document={zoneDocument}
          onSubmit={onSubmit}
        />
      </TooltipProvider>
    );
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Hello again" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        card: expect.objectContaining({
          pages: [{ id: "p1", title: "Page one" }, "p2"],
        }) as unknown,
        blocks: [
          expect.objectContaining({ _componentType: "card", pages: ["p3"] }),
        ],
      })
    );
    expect(
      screen.getByRole("group", { name: "Restricted or missing item p2" })
    ).toBeTruthy();
  });
});
