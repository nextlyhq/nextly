// @vitest-environment jsdom

/**
 * Delete on a template's document screen: what the dialog says for a
 * collection's template (the own designs it keeps, each saying whether it is
 * still shown) and for an entry's own design, and that the delete runs only
 * once confirmed, only while the document may be written, and is offered only
 * once its dry run says the site would accept it.
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
let dryRunAnswer: () => Promise<unknown> = () => judged([]);

/** A dry run's answer, refusing in `refusals`' words or accepting. */
function judged(refusals: string[]): Promise<unknown> {
  return Promise.resolve({
    message: "",
    item: { dryRun: true, kind: "delete-template", refusals },
  });
}

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: () => ({
    data: designs,
    error: null,
    pending: designs === undefined,
    fetching: false,
    refetch: () => {},
  }),
  writePluginRoute: (args: { body: { dryRun?: boolean } }) => {
    writes.push(args.body);
    return args.body.dryRun === true ? dryRunAnswer() : writeAnswer();
  },
  apiErrorMessage: (error: Error, fallback: string) =>
    error.message === "" ? fallback : error.message,
}));

const { TemplateDeleteAction } = await import("./TemplateDeleteAction");

function answer(
  options: {
    entry?: string | null;
    hasNext?: boolean;
    none?: boolean;
    status?: "draft" | "published";
  } = {}
): EntryDesignsResponse {
  const listed: EntryDesignsResponse["items"] = [
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
  const items = options.none === true ? [] : listed;
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 500,
      totalPages: 1,
      hasNext: options.hasNext ?? false,
      hasPrev: false,
      template: {
        id: "t1",
        title: "Blog post",
        status: options.status ?? "published",
      },
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

/** The dry run of deleting `id`, as the dialog sends it. */
function dryRunOf(id: string) {
  return { action: { kind: "delete-template", id }, dryRun: true };
}

/** The confirming button, once the dry run has settled it. */
async function confirmButton(name: string | RegExp): Promise<HTMLElement> {
  const button = screen.getByRole("button", { name });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  return button;
}

afterEach(() => {
  cleanup();
  designs = undefined;
  writes.length = 0;
  writeAnswer = () => Promise.resolve({ message: "", item: {} });
  dryRunAnswer = () => judged([]);
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

    fireEvent.click(await confirmButton("Delete template"));
    await waitFor(() => expect(close).toHaveBeenCalledWith("deleted"));
    expect(writes).toEqual([
      dryRunOf("t1"),
      { action: { kind: "delete-template", id: "t1" } },
    ]);
  });

  it("says a draft template's entries stay unshown, never that they stop being shown", () => {
    // A draft template shows no entry today, so its delete stops nothing.
    designs = answer({ status: "draft" });
    open("t1");
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete the Blog post template?",
    });
    expect(
      within(dialog).getByText(
        "Posts without their own design aren't shown as pages now, since this template isn't published. They stay that way until Posts have a published template."
      )
    ).toBeTruthy();
    expect(within(dialog).queryByText(/stop being shown/)).toBeNull();
    // The own designs it keeps are listed as for a published one.
    expect(
      within(dialog).getByRole("list", { name: "Posts with their own design" })
    ).toBeTruthy();
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

  it("does not say none are kept when none are listed but more may exist", () => {
    // The read stopped before it looked at every own design, so an empty
    // list is not "none": the dialog says some may be kept.
    designs = answer({ none: true, hasNext: true });
    open("t1");
    expect(
      screen.getByText(
        "Some posts may have their own design that isn't listed here."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Their own designs are kept, and serve them once published."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says nothing of kept own designs where the whole list is empty", () => {
    designs = answer({ none: true });
    open("t1");
    expect(screen.queryByText(/may have their own design/)).toBeNull();
    expect(
      screen.queryByText(
        "Their own designs are kept, and serve them once published."
      )
    ).toBeNull();
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

  it("refuses while the document may not be written, and deletes nothing", async () => {
    designs = answer();
    const close = open("t1", false);
    fireEvent.click(await confirmButton("Delete template"));
    expect(
      screen.getByText("This document's changes are on hold.")
    ).toBeTruthy();
    expect(writes).toEqual([dryRunOf("t1")]);
    expect(close).not.toHaveBeenCalled();
  });

  it("shows a refusal the confirmed delete meets after its dry run, and stays open", async () => {
    // The dry run accepted, then something changed before the delete: the
    // delete is judged again, and its refusal is said in the dialog.
    designs = answer();
    writeAnswer = () => Promise.reject(new Error("Refused by a rule."));
    const close = open("t1");
    fireEvent.click(await confirmButton("Delete template"));
    expect(await screen.findByText("Refused by a rule.")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes with nothing when the author cancels", () => {
    designs = answer();
    const close = open("t1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledWith();
    expect(writes).toEqual([dryRunOf("t1")]);
  });
});

describe("the delete's dry run", () => {
  it("says the site's refusal before anything is confirmed, and offers no delete", async () => {
    designs = answer();
    dryRunAnswer = () =>
      judged(["A template still named by a page can't be deleted."]);
    const close = open("t1");

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("This can't be deleted.")).toBeTruthy();
    expect(
      within(alert).getByText(
        "A template still named by a page can't be deleted."
      )
    ).toBeTruthy();
    const button = screen.getByRole("button", { name: "Delete template" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    // Only the dry run was sent: the refused delete is never attempted.
    expect(writes).toEqual([dryRunOf("t1")]);
    expect(close).not.toHaveBeenCalled();
  });

  it("lists each refusal when the site gives more than one", async () => {
    designs = answer({ entry: "p2" });
    dryRunAnswer = () => judged(["First reason.", "Second reason."]);
    open("d2");
    const alert = await screen.findByRole("alert");
    expect(
      within(alert)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["First reason.", "Second reason."]);
    expect(
      screen
        .getByRole("button", { name: "Remove own design" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("says it is checking, and holds the delete, while the dry run is out", () => {
    designs = answer();
    dryRunAnswer = () => new Promise(() => {});
    open("t1");
    expect(screen.getByRole("status").textContent).toBe(
      "Checking whether it can be deleted…"
    );
    expect(
      screen
        .getByRole("button", { name: "Delete template" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("offers a retry when the dry run fails, and the delete once it answers", async () => {
    designs = answer();
    dryRunAnswer = () => Promise.reject(new Error(""));
    open("t1");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Whether it can be deleted couldn't be checked."
    );
    expect(
      screen
        .getByRole("button", { name: "Delete template" })
        .hasAttribute("disabled")
    ).toBe(true);

    dryRunAnswer = () => judged([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await confirmButton("Delete template");
    expect(writes).toEqual([dryRunOf("t1"), dryRunOf("t1")]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
