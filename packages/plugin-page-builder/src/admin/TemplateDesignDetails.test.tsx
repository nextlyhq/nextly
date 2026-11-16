// @vitest-environment jsdom
/**
 * An own design's "Own design" section: the entry it serves, that entry's
 * collection and id, and the template it was copied from, read from the form
 * and named by the own-designs read; nothing on a collection's template, and
 * nothing outside a form.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm, type FieldValues } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";

let designs: EntryDesignsResponse | undefined;
const asked: string[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path, enabled }: { path: string; enabled?: boolean }) => {
    if (enabled !== false) asked.push(path);
    return {
      data: enabled === false ? undefined : designs,
      error: null,
      pending: false,
      fetching: false,
      refetch: () => {},
    };
  },
  navigateTo: () => {},
}));

const { designDetailRows, TemplateDesignDetails } = await import(
  "./TemplateDesignDetails"
);

function answer(templateId = "t1"): EntryDesignsResponse {
  return {
    items: [
      {
        id: "d1",
        entryId: "e1",
        title: "Ten years of field notes",
        status: "published",
        updatedAt: null,
      },
    ],
    meta: {
      total: 1,
      page: 1,
      limit: 500,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      template: { id: templateId, title: "Blog post", status: "published" },
      templateReadable: true,
      templateAllowed: true,
      mayCreateTemplate: false,
      mayGiveDesign: true,
      entry: "e1",
      templatesCollection: "templates",
      names: { singular: "Post", plural: "Posts" },
      collection: "posts",
    },
  };
}

const OWN = {
  entry: "posts/e1",
  entryCollection: "posts",
  entryId: "e1",
  forkedFrom: "t1",
};

const LOCK = { readOnly: false, actionsDisabled: false };

function Panel({ defaults }: { defaults: FieldValues }) {
  const form = useForm({ defaultValues: defaults });
  return (
    <FormProvider {...form}>
      <TemplateDesignDetails
        collectionSlug="templates"
        entryId="d1"
        documentLock={LOCK}
        mayWrite={() => true}
        documentChanged={() => {}}
      />
    </FormProvider>
  );
}

/** The section's rows as label and value. */
function rowsOnScreen(): string[][] {
  return [...document.querySelectorAll("dl > div")].map(row => [
    row.querySelector("dt")?.textContent ?? "",
    row.querySelector("dd")?.textContent ?? "",
  ]);
}

afterEach(() => {
  cleanup();
  designs = undefined;
  asked.length = 0;
});

describe("an own design's section", () => {
  it("says the entry, its collection and id, and the template it was copied from", () => {
    designs = answer();
    render(<Panel defaults={{ title: "Ten years", ...OWN }} />);
    expect(rowsOnScreen()).toEqual([
      ["Entry", "Ten years of field notes"],
      ["Entry's collection", "Posts"],
      ["Entry id", "e1"],
      ["Copied from", "Blog post"],
    ]);
    expect(
      screen
        .getByRole("link", { name: "Ten years of field notes" })
        .getAttribute("href")
    ).toBe("/admin/collections/posts/e1");
    expect(
      screen.getByRole("link", { name: "Blog post" }).getAttribute("href")
    ).toBe("/admin/collections/templates/t1");
    // Read-only: the section draws nothing to type into.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says the source template is gone once it was deleted", () => {
    designs = answer();
    render(<Panel defaults={{ ...OWN, forkedFrom: null }} />);
    expect(rowsOnScreen().at(-1)).toEqual([
      "Copied from",
      "A template since deleted",
    ]);
  });

  it("names a source the read does not by its id", () => {
    // The collection's template now is another than the one it was copied
    // from, so the read's title would name the wrong template.
    designs = answer("t2");
    render(<Panel defaults={OWN} />);
    expect(rowsOnScreen().at(-1)).toEqual(["Copied from", "t1"]);
  });

  it("says the slugs before the read answers, rather than nothing", () => {
    render(<Panel defaults={OWN} />);
    expect(rowsOnScreen()).toEqual([
      ["Entry", "Open entry"],
      ["Entry's collection", "posts"],
      ["Entry id", "e1"],
      ["Copied from", "t1"],
    ]);
  });

  it("draws nothing on a collection's template, and asks nothing", () => {
    designs = answer();
    const { container } = render(
      <Panel
        defaults={{
          collection: "posts",
          entry: null,
          entryCollection: null,
          entryId: null,
          forkedFrom: null,
        }}
      />
    );
    expect(container.textContent).toBe("");
    expect(asked).toEqual([]);
  });

  it("draws nothing outside a form", () => {
    designs = answer();
    const { container } = render(
      <TemplateDesignDetails
        collectionSlug="templates"
        entryId="d1"
        documentLock={LOCK}
        mayWrite={() => true}
        documentChanged={() => {}}
      />
    );
    expect(container.textContent).toBe("");
  });
});

describe("designDetailRows", () => {
  it("names the collection only from a read about that collection", () => {
    const rows = designDetailRows(
      {
        entry: "events/e1",
        entryCollection: "events",
        entryId: "e1",
        forkedFrom: null,
      },
      answer()
    );
    expect(rows.find(row => row.label === "Entry's collection")?.value).toBe(
      "events"
    );
  });
});
