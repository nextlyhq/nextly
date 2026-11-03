// @vitest-environment jsdom

/**
 * "Remove Layout…" and its dialog: what the author is shown for each answer
 * of the dry run, and that only the state with nothing in the way offers a
 * removal to confirm.
 *
 * The route is replaced by a recorder; what the route answers on a real site
 * is the integration suite's, and the dialog in a browser is the e2e suite's.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RemovalCheck } from "../layout-removal/remove-layout";

const calls: unknown[] = [];
let answer: (body: { dryRun: boolean }) => Promise<unknown> = async () =>
  undefined;
const navigated: string[] = [];

let identity: { kind: string; slug: string; documentId?: string } | null = null;
let documentStatus: { status: string; hasWorkingDraft: boolean } | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: (args: { body: { dryRun: boolean } }) => {
    calls.push(args);
    return answer(args.body);
  },
  navigateTo: (to: string) => {
    navigated.push(to);
  },
  useDocumentIdentity: () => identity,
  useDocumentStatus: () => documentStatus,
}));

const { RemoveLayoutAction, RemoveLayoutToolbarSlot } = await import(
  "./RemoveLayoutAction"
);

function check(overrides: Partial<RemovalCheck> = {}): RemovalCheck {
  return {
    isDefault: false,
    pages: [],
    unreadable: 0,
    complete: true,
    pagesCollection: "pages",
    ...overrides,
  };
}

function dryRunAnswers(found: RemovalCheck) {
  answer = async body =>
    body.dryRun
      ? { message: "", item: { check: found } }
      : { message: "The Layout was deleted.", item: {} };
}

function openDialog(status = "published") {
  render(
    <RemoveLayoutAction
      collectionSlug="layouts"
      entryId="landing"
      published={status === "published"}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Layout…" }));
}

beforeEach(() => {
  calls.length = 0;
  navigated.length = 0;
});

describe("Remove Layout…", () => {
  it("draws nothing while a Layout is being created", () => {
    const { container } = render(
      <RemoveLayoutAction
        collectionSlug="layouts"
        entryId="create"
        published={false}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the default's reason and offers nothing to confirm", async () => {
    dryRunAnswers(check({ isDefault: true }));
    openDialog();

    expect(
      await screen.findByText(
        "This Layout is the site's default. Choose another default first."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Layout" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("lists the pages that use it as links that open each page, counting the unreadable", async () => {
    dryRunAnswers(
      check({ pages: [{ id: "p1", title: "Home" }], unreadable: 2 })
    );
    openDialog();

    expect(
      await screen.findByText(
        "These pages use this Layout. Choose another Layout for them first."
      )
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/admin/collections/pages/p1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("And 2 pages you can't view.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Layout" })).toBeNull();
  });

  it("says 'at least' when the check could not reach every page", async () => {
    dryRunAnswers(
      check({ pages: [{ id: "p1", title: "Home" }], complete: false })
    );
    openDialog();

    expect(
      await screen.findByText(
        "At least 1 page uses this Layout. Not every page could be checked."
      )
    ).toBeTruthy();
  });

  it("offers unpublish and delete when nothing is in the way, and deletes on confirm", async () => {
    dryRunAnswers(check());
    openDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Layout" })
    );

    await waitFor(() =>
      expect(navigated).toEqual(["/admin/collections/layouts"])
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      path: "/layouts/landing/remove",
      body: { action: "delete", dryRun: false },
    });
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeTruthy();
  });

  it("offers no unpublish for a Layout that is not published", async () => {
    dryRunAnswers(check());
    openDialog("draft");

    await screen.findByRole("button", { name: "Delete Layout" });
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
  });

  it("shows a refusal the removal meets in the dialog", async () => {
    answer = async body => {
      if (body.dryRun) return { message: "", item: { check: check() } };
      throw new Error("This Layout is already being removed.");
    };
    openDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Layout" })
    );

    expect(
      await screen.findAllByText("This Layout is already being removed.")
    ).not.toHaveLength(0);
    expect(navigated).toEqual([]);
  });
});

describe("a dry run that answers after the dialog closed", () => {
  it("does not open the dialog again", async () => {
    let finish: (value: unknown) => void = () => {};
    answer = () =>
      new Promise(resolve => {
        finish = resolve;
      });
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    finish({ message: "", item: { check: check() } });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does not show a failure either", async () => {
    let fail: (reason: unknown) => void = () => {};
    answer = () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      });
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fail(new Error("The Layout could not be checked."));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("in the document bar", () => {
  it("offers Remove Layout on a Layout's edit screen", () => {
    identity = { kind: "collection", slug: "layouts", documentId: "landing" };
    documentStatus = { status: "published", hasWorkingDraft: false };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    expect(screen.getByRole("button", { name: "Remove Layout…" })).toBeTruthy();
  });

  it.each([
    [
      "another collection's form",
      { kind: "collection", slug: "pages", documentId: "p1" },
    ],
    ["a Single's form", { kind: "single", slug: "layouts" }],
    ["a Layout not saved yet", { kind: "collection", slug: "layouts" }],
  ])("draws nothing on %s", (_label, form) => {
    identity = form;
    documentStatus = { status: "draft", hasWorkingDraft: false };
    const { container } = render(
      <RemoveLayoutToolbarSlot context="collection" />
    );
    expect(container.innerHTML).toBe("");
  });
});
