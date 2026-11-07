// @vitest-environment jsdom

/**
 * Delete on a template's document screen: what the dialog says for a
 * collection's template (the own designs it keeps, each saying whether it is
 * still shown) and for an entry's own design, and that the delete runs only
 * once confirmed, and only while the document may be written.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";

let designs: EntryDesignsResponse | undefined;
const writes: unknown[] = [];
let writeAnswer: () => Promise<unknown> = () =>
  Promise.resolve({ message: "", item: {} });

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: () => ({
    data: designs,
    error: null,
    pending: designs === undefined,
    fetching: false,
    refetch: () => {},
  }),
  writePluginRoute: (args: { body: unknown }) => {
    writes.push(args.body);
    return writeAnswer();
  },
  apiErrorMessage: (error: Error, fallback: string) =>
    error.message === "" ? fallback : error.message,
}));

const { TemplateDeleteAction } = await import("./TemplateDeleteAction");

function answer(
  options: { entry?: string | null; hasNext?: boolean } = {}
): EntryDesignsResponse {
  const items: EntryDesignsResponse["items"] = [
    {
      id: "d1",
      entryId: "p1",
      title: "Ten years of field notes",
      status: "published",
      updatedAt: null,
    },
    {
      id: "d2",
      entryId: "p2",
      title: "Our spring catalogue",
      status: "draft",
      updatedAt: null,
    },
  ];
  return {
    items,
    meta: {
      total: 2,
      page: 1,
      limit: 500,
      totalPages: 1,
      hasNext: options.hasNext ?? false,
      hasPrev: false,
      template: { id: "t1", title: "Blog post", status: "published" },
      templateReadable: true,
      templateAllowed: true,
      mayCreateTemplate: false,
      mayGiveDesign: true,
      entry: options.entry ?? null,
      templatesCollection: "templates",
      names: { singular: "Post", plural: "Posts" },
      collection: "posts",
    },
  };
}

function open(entryId: string, writable = true) {
  const close = vi.fn();
  render(
    <TemplateDeleteAction
      action="delete"
      collectionSlug="templates"
      entryId={entryId}
      documentLock={{ readOnly: false, actionsDisabled: false }}
      mayWrite={() => writable}
      close={close}
    />
  );
  return close;
}

afterEach(() => {
  cleanup();
  designs = undefined;
  writes.length = 0;
  writeAnswer = () => Promise.resolve({ message: "", item: {} });
});

describe("deleting a template", () => {
  it("lists the own designs it keeps, and says the others stop being pages", async () => {
    designs = answer();
    const close = open("t1");

    const dialog = screen.getByRole("alertdialog", {
      name: "Delete the Blog post template?",
    });
    expect(
      within(dialog).getByText(
        "Posts without their own design stop being shown as pages until Posts have a published template again."
      )
    ).toBeTruthy();
    const kept = within(dialog).getByRole("list", {
      name: "Posts with their own design",
    });
    const rows = within(kept).getAllByRole("listitem");
    expect(rows.map(row => row.textContent)).toEqual([
      "Ten years of field notesStill shown",
      "Our spring catalogueNot shown until its design is published",
    ]);
    expect(within(dialog).getByText("2 · kept")).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete template" })
    );
    await waitFor(() => expect(close).toHaveBeenCalledWith("deleted"));
    expect(writes).toEqual([{ action: { kind: "delete-template", id: "t1" } }]);
  });

  it("offers each kept entry's whole title where the list cuts it to one line", () => {
    designs = answer();
    open("t1");
    const kept = screen.getByRole("list", {
      name: "Posts with their own design",
    });
    for (const title of ["Ten years of field notes", "Our spring catalogue"]) {
      const cut = within(kept).getByText(title);
      expect(cut.className).toContain("truncate");
      expect(cut.getAttribute("title")).toBe(title);
    }
  });

  it("says when the list of kept own designs was cut", () => {
    designs = answer({ hasNext: true });
    open("t1");
    expect(screen.getByText("And more not listed here.")).toBeTruthy();
  });

  it("asks about an own design as the entry's Design section does", () => {
    // Asked about an own design, the read answers for its entry alone.
    designs = answer({ entry: "p2" });
    open("d2");
    expect(
      screen.getByRole("alertdialog", {
        name: "Remove this post's own design?",
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        '"Our spring catalogue" will be shown with the Blog post template again. The own design and its history are deleted.'
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove own design" })
    ).toBeTruthy();
  });

  it("does not take an own design from the collection's capped list", () => {
    // A collection-wide answer that happens to list d2 is not the entry's
    // own lookup, so the dialog does not call it an own design.
    designs = answer();
    open("d2");
    expect(
      screen.getByRole("alertdialog", { name: "Delete this template?" })
    ).toBeTruthy();
  });

  it("offers nothing to confirm until it knows what the template draws", () => {
    designs = undefined;
    open("t1");
    expect(screen.getByText("Checking what this template draws…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("refuses while the document may not be written, and writes nothing", () => {
    designs = answer();
    const close = open("t1", false);
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect(
      screen.getByText("This document's changes are on hold.")
    ).toBeTruthy();
    expect(writes).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });

  it("shows the site's refusal and stays open", async () => {
    designs = answer();
    writeAnswer = () => Promise.reject(new Error("Refused by a rule."));
    const close = open("t1");
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect(await screen.findByText("Refused by a rule.")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes with nothing when the author cancels", () => {
    designs = answer();
    const close = open("t1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledWith();
    expect(writes).toEqual([]);
  });
});
