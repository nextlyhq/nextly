/**
 * Removing a link the editor cannot see takes out exactly that link.
 *
 * Each input is rendered in a real form holding a placeholder beside a
 * readable link, the two sharing what an id-based removal would confuse: the
 * same id from another collection, or a sibling a rebuild from ids would strip
 * of its collection. The form's value is read back after the click.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { fireEvent, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

import { renderWithProviders } from "../../../../__tests__/utils";

import { UploadInput } from "./media/UploadInput";
import { RelationshipInput } from "./relational/RelationshipInput";

const hiddenPair = (relationTo: string, value: string) => ({
  relationTo,
  value,
  [RESTRICTED_REFERENCE]: true,
});

/** The latest value of the field, as the form holds it. */
let latest: unknown;

function RelationshipHarness({ initial }: { initial: unknown[] }) {
  const form = useForm<{ related: unknown[] }>({
    defaultValues: { related: initial },
  });
  latest = form.watch("related");
  return (
    <TooltipProvider>
      <RelationshipInput
        name="related"
        control={form.control}
        field={{
          type: "relationship",
          name: "related",
          relationTo: ["pages", "notes"],
          hasMany: true,
        }}
      />
    </TooltipProvider>
  );
}

function UploadHarness({ initial }: { initial: unknown[] }) {
  const form = useForm<{ gallery: unknown[] }>({
    defaultValues: { gallery: initial },
  });
  latest = form.watch("gallery");
  return (
    <UploadInput
      name="gallery"
      control={form.control}
      field={{
        type: "upload",
        name: "gallery",
        relationTo: ["media", "files"],
        hasMany: true,
      }}
    />
  );
}

describe("removing a restricted link", () => {
  it("in a relationship, leaves a readable link with the same id from another collection", () => {
    const readable = {
      relationTo: "pages",
      value: { id: "x", title: "Page X" },
    };
    renderWithProviders(
      <RelationshipHarness initial={[readable, hiddenPair("notes", "x")]} />
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove restricted or missing item x",
      })
    );
    expect(latest).toEqual([readable]);
  });

  it("in an upload, keeps a restricted sibling's collection when another file is removed", () => {
    renderWithProviders(
      <UploadHarness
        initial={[
          hiddenPair("files", "f1"),
          { id: "m1", filename: "one.png", url: "/one.png" },
        ]}
      />
    );
    expect(
      screen.getByRole("group", { name: "Restricted or missing item f1" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));
    expect(latest).toEqual([hiddenPair("files", "f1")]);
  });

  it("in an upload, removes one of a file linked twice and keeps the other", () => {
    const placeholder = { id: "m9", [RESTRICTED_REFERENCE]: true };
    renderWithProviders(
      <UploadHarness initial={[placeholder, "m2", placeholder]} />
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Remove restricted or missing item m9",
      })[0]
    );
    expect(latest).toEqual(["m2", placeholder]);
  });
});
