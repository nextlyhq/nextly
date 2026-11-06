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

/** A request body, as the dialog sends it to the route. */
interface Body {
  readonly action?: string;
  readonly dryRun?: boolean;
  readonly move?: true;
  readonly token?: string;
  readonly after?: string;
  readonly stop?: true;
}

const calls: { body: Body }[] = [];
let answer: (body: Body) => Promise<unknown> = async () => undefined;
const navigated: string[] = [];

let identity: { kind: string; slug: string; documentId?: string } | null = null;
let documentStatus: { status: string; hasWorkingDraft: boolean } | null = null;
/** The editor's own actions, as `useDocumentActions` answers them. */
let editorActions: {
  actions: { id: string; disabledReason?: string }[];
} | null = {
  actions: [{ id: "unpublish" }, { id: "delete" }],
};
/** The collections as the site resolved them. */
let resolved = { pagesCollection: "pages", layoutsCollection: "layouts" };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: (args: { body: Body }) => {
    calls.push(args);
    return answer(args.body);
  },
  navigateTo: (to: string) => {
    navigated.push(to);
  },
  useDocumentIdentity: () => identity,
  useDocumentStatus: () => documentStatus,
  useDocumentActions: () => editorActions,
  usePluginRoute: ({ enabled }: { enabled?: boolean }) => ({
    data: enabled === false ? undefined : resolved,
    error: null,
    pending: false,
    refetch: () => {},
  }),
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
    liveRows: 0,
    siteDefault: "Main",
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

  it("says 'at least' when the check could not reach every page, offering no move", async () => {
    dryRunAnswers(
      check({
        pages: [{ id: "p1", title: "Home", state: "published" }],
        complete: false,
      })
    );
    openDialog();

    expect(
      await screen.findByText(
        "At least 1 page uses this Layout. Not every page could be checked."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "These pages use this Layout. Choose another Layout for them first."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
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
  beforeEach(() => {
    resolved = { pagesCollection: "pages", layoutsCollection: "layouts" };
    editorActions = { actions: [{ id: "unpublish" }, { id: "delete" }] };
  });

  it("offers Remove Layout on a renamed Layouts collection's form", () => {
    resolved = { pagesCollection: "pages", layoutsCollection: "site-layouts" };
    identity = {
      kind: "collection",
      slug: "site-layouts",
      documentId: "landing",
    };
    documentStatus = { status: "published", hasWorkingDraft: false };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    expect(screen.getByRole("button", { name: "Remove Layout…" })).toBeTruthy();
  });

  it("holds the button while the editor holds the document's writes, saying why", () => {
    editorActions = {
      actions: [
        { id: "unpublish", disabledReason: "A past version is on screen." },
        { id: "delete", disabledReason: "A past version is on screen." },
      ],
    };
    identity = { kind: "collection", slug: "layouts", documentId: "landing" };
    documentStatus = { status: "published", hasWorkingDraft: false };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    const button = screen.getByRole("button", { name: "Remove Layout…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("A past version is on screen.");
  });

  it("holds it when the editor offers neither a delete nor an unpublish", () => {
    editorActions = { actions: [{ id: "save" }] };
    identity = { kind: "collection", slug: "layouts", documentId: "landing" };
    documentStatus = { status: "published", hasWorkingDraft: false };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    expect(
      (
        screen.getByRole("button", {
          name: "Remove Layout…",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("leaves it free when one of the two can run", () => {
    editorActions = {
      actions: [
        { id: "unpublish" },
        { id: "delete", disabledReason: "You can't delete layouts." },
      ],
    };
    identity = { kind: "collection", slug: "layouts", documentId: "landing" };
    documentStatus = { status: "published", hasWorkingDraft: false };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    expect(
      (
        screen.getByRole("button", {
          name: "Remove Layout…",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

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

describe("a delete that a page published meanwhile still names", () => {
  it("says so in the dialog, and returns to the list only once the author has read it", async () => {
    const sentence =
      "Home still uses this Layout. It shows the site default until it is published with another Layout.";
    answer = async body =>
      body.dryRun
        ? { message: "", item: { check: check() } }
        : {
            message: sentence,
            item: {
              stillUsedBy: {
                pages: [{ id: "p1", title: "Home" }],
                unreadable: 0,
              },
            },
          };
    openDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Layout" })
    );

    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(navigated).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Back to Layouts" }));
    expect(navigated).toEqual(["/admin/collections/layouts"]);
  });
});

describe("moving the pages to the site default first", () => {
  /** Forty pages: three named, two of them published, one edited. */
  const forty = () =>
    check({
      pages: [
        { id: "p1", title: "Pricing", state: "published" },
        { id: "p2", title: "About us", state: "unpublished" },
        { id: "p3", title: "Home", state: "edited" },
        ...Array.from({ length: 37 }, (_, i) => ({
          id: `q${String(i)}`,
          title: `Page ${String(i)}`,
          state: "unpublished" as const,
        })),
      ],
      liveRows: 12,
    });

  /** The route: a dry run answering `found`, and each move tick `ticks` asks. */
  function moveAnswers(
    found: RemovalCheck,
    ticks: (body: Body) => Promise<unknown>
  ) {
    answer = async body => {
      if (body.dryRun === true) return { message: "", item: { check: found } };
      if (body.stop === true) {
        return { message: "", item: { move: { state: "stopped", moved: 0 } } };
      }
      return { message: "", item: { move: await ticks(body) } };
    };
  }

  const moving = (moved: number, after: string) => ({
    state: "moving",
    token: "11111111-1111-4111-8111-111111111111",
    moved,
    left: 40 - moved,
    after,
    refused: [],
  });

  it("offers the move, naming the first pages with their state, the rest counted, and the published ones' switch", async () => {
    moveAnswers(forty(), async () => moving(0, "p1"));
    openDialog();

    expect(
      await screen.findByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "40 pages use this Layout. Move them to the site default, Main, and then delete or unpublish it, or close and choose another Layout for them yourself."
      )
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pricing" })).toBeTruthy();
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Unpublished")).toBeTruthy();
    expect(screen.getByText("Published · unsaved edits")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Page 0" })).toBeNull();
    expect(screen.getByText("and 37 more")).toBeTruthy();
    expect(
      screen.getByText(
        "12 published pages switch to Main's header and footer right away."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Move 40 pages, then delete" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Move 40 pages, then unpublish" })
    ).toBeTruthy();
  });

  it("shows the bar while it moves, ticking with the token and cursor each answer gives", async () => {
    let release: (value: unknown) => void = () => {};
    moveAnswers(forty(), body =>
      body.token === undefined
        ? Promise.resolve(moving(12, "q8"))
        : new Promise(resolve => {
            release = resolve;
          })
    );
    openDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Move 40 pages, then delete" })
    );

    expect(await screen.findByText("Moved 12 of 40 pages…")).toBeTruthy();
    expect(screen.getByText("Moving pages")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Moving…" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.body).toEqual({
      action: "delete",
      move: true,
      token: "11111111-1111-4111-8111-111111111111",
      after: "q8",
    });
    release(moving(0, "q9"));
  });

  it("stops between ticks, keeping what moved, and offers to move the rest", async () => {
    let release: (value: unknown) => void = () => {};
    moveAnswers(forty(), body =>
      body.token === undefined
        ? new Promise(resolve => {
            release = resolve;
          })
        : Promise.resolve(moving(0, "q9"))
    );
    openDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move 40 pages, then delete" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

    release(moving(12, "q8"));

    expect(
      await screen.findByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "12 pages now use the site default, Main. 28 still use this Layout, so it was not deleted."
      )
    ).toBeTruthy();
    expect(screen.getByText("Moved 12 of 40 pages")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Move the other 28, then delete" })
    ).toBeTruthy();
    // No next tick: the only call after the first is the Stop.
    expect(calls.slice(1).map(call => call.body)).toEqual([
      { action: "delete", move: true },
      {
        action: "delete",
        move: true,
        token: "11111111-1111-4111-8111-111111111111",
        stop: true,
      },
    ]);
  });

  it("says every page moved and the Layout was deleted, leaving for the list on Close", async () => {
    moveAnswers(forty(), async body =>
      body.token === undefined
        ? moving(25, "q20")
        : { state: "done", moved: 15 }
    );
    openDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move 40 pages, then delete" })
    );

    expect(
      await screen.findByText(
        "40 pages moved to the site default, Main, and the Layout was deleted."
      )
    ).toBeTruthy();
    // The outcome is marked by an icon beside the title, not by colouring
    // the sentence.
    expect(
      screen
        .getByText("Layout deleted")
        .querySelector('svg[aria-hidden="true"]')
    ).not.toBeNull();
    expect(navigated).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(navigated).toEqual(["/admin/collections/layouts"]);
  });

  it("names a page it could not move, with why, and offers to try again", async () => {
    moveAnswers(forty(), async body =>
      body.token === undefined
        ? {
            ...moving(25, "q20"),
            refused: [
              {
                id: "p1",
                title: "Pricing",
                reason: "You can't edit this page.",
              },
            ],
          }
        : {
            state: "refused",
            moved: 14,
            pages: [{ id: "p1", title: "Pricing", reason: null }],
            unreadable: 0,
            complete: true,
          }
    );
    openDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move 40 pages, then delete" })
    );

    expect(
      await screen.findByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "39 of 40 pages moved to the site default, Main. The Layout was not deleted, because one page still uses it:"
      )
    ).toBeTruthy();
    expect(screen.getByText("Some pages couldn't be moved")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pricing" })).toBeTruthy();
    // The reason an earlier tick gave, kept by the dialog.
    expect(screen.getByText("You can't edit this page.")).toBeTruthy();
    expect(
      screen.getByText(
        "Ask someone who can edit it to choose another Layout, then try again."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("still leaves for the list when the tick in flight as the dialog closed deleted the Layout", async () => {
    let release: (value: unknown) => void = () => {};
    moveAnswers(forty(), body =>
      body.token === undefined
        ? Promise.resolve(moving(25, "q20"))
        : new Promise(resolve => {
            release = resolve;
          })
    );
    openDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move 40 pages, then delete" })
    );
    await screen.findByText("Moved 25 of 40 pages…");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(navigated).toEqual([]);
    release({ state: "done", moved: 15 });

    await waitFor(() =>
      expect(navigated).toEqual(["/admin/collections/layouts"])
    );
  });

  it("stops the move when the dialog is closed while pages move", async () => {
    let release: (value: unknown) => void = () => {};
    moveAnswers(forty(), body =>
      body.token === undefined
        ? Promise.resolve(moving(12, "q8"))
        : new Promise(resolve => {
            release = resolve;
          })
    );
    openDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move 40 pages, then delete" })
    );
    await screen.findByText("Moved 12 of 40 pages…");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // Stopped at once, not when the tick in flight comes back.
    const stops = calls.filter(call => call.body.stop === true);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0]?.body.token).toBe("11111111-1111-4111-8111-111111111111");
    release(moving(10, "q18"));
    await new Promise(resolve => setTimeout(resolve, 20));
    // No tick after the one in flight when it closed.
    expect(
      calls.filter(call => call.body.move === true && call.body.stop !== true)
    ).toHaveLength(2);
  });
});
