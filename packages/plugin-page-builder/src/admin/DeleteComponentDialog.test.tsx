// @vitest-environment jsdom

/**
 * The Delete component dialog: what the author is shown for each answer of
 * the routes, that only a state with nothing in the way offers a delete, that
 * the delete is carried on by calling the route again until it is finished,
 * and that closing stops calling it.
 *
 * The route is replaced by a recorder; what the route answers on a real site
 * is the integration suite's, and the dialog in a browser is the e2e suite's.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ComponentDeleteResult,
  DocumentList,
} from "../component-delete/contract";
import { MESSAGES, SOMEONE_ELSE_IS_DELETING } from "../component-delete/words";

/** A request body, as the dialog sends it. */
interface Body {
  readonly dryRun?: true;
}

/** An error as the admin's API client throws it. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const calls: Body[] = [];
let answer: (body: Body) => Promise<unknown> = async () => undefined;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: (args: { body: Body }) => {
    calls.push(args.body);
    return answer(args.body);
  },
  isApiError: (error: unknown) =>
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number",
  apiErrorMessage: (error: Error, fallback: string) =>
    error.message === "" ? fallback : error.message,
  validationIssues: () => [],
  usePluginRouteMutation: () => ({}),
}));

const { DeleteComponentDialog, checkedFace } = await import(
  "./DeleteComponentDialog"
);

const NONE: DocumentList = { named: [], unreadable: 0, more: 0 };

/** An answer of the routes, with what a case does not say left empty. */
function result(
  rest: Partial<ComponentDeleteResult> & Pick<ComponentDeleteResult, "status">
): ComponentDeleteResult {
  return {
    componentId: "c1",
    mayDelete: true,
    run: null,
    ...rest,
  };
}

/** The envelope the route wraps an answer in. */
function envelope(item: ComponentDeleteResult) {
  return Promise.resolve({ message: "", item });
}

const USED = result({
  status: "used",
  plan: {
    convert: {
      named: [
        { kind: "collection", slug: "pages", id: "p1", title: "Home" },
        { kind: "single", slug: "site-footer", title: "Footer" },
      ],
      unreadable: 1,
      more: 0,
    },
    drafts: NONE,
    mayBeRefused: 0,
  },
});

const handlers = { onClose: vi.fn(), onDeleted: vi.fn() };

/**
 * Whether `text` is on screen. The dialog's live region says some states in
 * the same words as the visible sentence, so more than one match is right.
 */
async function shown(text: string): Promise<void> {
  expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
}

function show(name: string | null = "Hero"): void {
  render(
    <DeleteComponentDialog
      componentId="c1"
      name={name}
      open
      onClose={handlers.onClose}
      onDeleted={handlers.onDeleted}
      leaveLabel="Back to Components"
    />
  );
}

beforeEach(() => {
  calls.length = 0;
  handlers.onClose.mockReset();
  handlers.onDeleted.mockReset();
  answer = () => envelope(USED);
});

describe("the dry run", () => {
  it("asks the route for a dry run on opening, and focus starts on Cancel", async () => {
    show();
    expect(await screen.findByText("Home")).toBeTruthy();
    expect(calls).toEqual([{ dryRun: true }]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" })
    );
  });

  it("lists the documents that use it, counting the ones the author can't view, and offers to turn each copy into plain blocks", async () => {
    show();
    expect(await screen.findByText(/is used in 3 documents/)).toBeTruthy();
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.getAttribute("href")).toBe("/admin/collections/pages/p1");
    expect(
      screen.getByRole("link", { name: "Footer" }).getAttribute("href")
    ).toBe("/admin/singles/site-footer");
    expect(screen.getByText("and 1 document you can't view")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    ).toBeTruthy();
  });

  it("says which documents hold unpublished changes, and how many the author may not be allowed to change", async () => {
    answer = () =>
      envelope({
        ...USED,
        plan: {
          convert: USED.plan?.convert ?? NONE,
          drafts: {
            named: [
              { kind: "collection", slug: "pages", id: "p1", title: "Home" },
            ],
            unreadable: 0,
            more: 0,
          },
          mayBeRefused: 2,
        },
      });
    show();
    expect(
      await screen.findByText(/1 document has unpublished changes/)
    ).toBeTruthy();
    expect(
      screen.getByText(/You may not be allowed to change 2 of these/)
    ).toBeTruthy();
  });

  it("offers a plain delete when nothing uses it", async () => {
    answer = () =>
      envelope(
        result({
          status: "none",
          plan: { convert: NONE, drafts: NONE, mayBeRefused: 0 },
        })
      );
    show();
    expect(await screen.findByText(/Nothing uses/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Delete component" })
    ).toBeTruthy();
  });

  it("never says nothing uses it while the count is not whole, and asks again until it is", async () => {
    const partial = result({
      status: "none",
      plan: {
        convert: NONE,
        drafts: NONE,
        mayBeRefused: 0,
        complete: false,
      } as ComponentDeleteResult["plan"],
    });
    const whole = result({
      status: "none",
      plan: { convert: NONE, drafts: NONE, mayBeRefused: 0 },
    });
    let asked = 0;
    answer = () => {
      asked += 1;
      return envelope(asked === 1 ? partial : whole);
    };
    show();
    expect(await screen.findByText(/Still finding where/)).toBeTruthy();
    expect(screen.queryByText(/Nothing uses/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete component" })
    ).toBeNull();
    expect(
      await screen.findByText(/Nothing uses/, undefined, { timeout: 4000 })
    ).toBeTruthy();
    expect(calls).toEqual([{ dryRun: true }, { dryRun: true }]);
  });

  it("refuses with the Layouts that use it, and offers nothing to confirm", async () => {
    answer = () =>
      envelope(
        result({
          status: "refused",
          plan: { convert: NONE, drafts: NONE, mayBeRefused: 0 },
          layouts: {
            named: [
              { kind: "collection", slug: "layouts", id: "l1", title: "Main" },
            ],
            unreadable: 0,
            more: 0,
          },
        })
      );
    show();
    expect(await screen.findByText(/A Layout uses/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Main" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /then delete/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete component" })
    ).toBeNull();
  });

  it("refuses with each document that stops it, in the words the route gives", async () => {
    answer = () =>
      envelope(
        result({
          status: "refused",
          plan: { convert: NONE, drafts: NONE, mayBeRefused: 0 },
          left: [
            {
              document: {
                kind: "collection",
                slug: "pages",
                id: "p9",
                title: "Pricing",
              },
              reason: "unaddressable",
              words: "Remove the component there by hand.",
            },
            { document: null, reason: "not-permitted", words: "No rights." },
          ],
        })
      );
    show();
    expect(
      await screen.findByText("Remove the component there by hand.")
    ).toBeTruthy();
    expect(screen.getByText(/A document you can.t view/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /then delete/ })).toBeNull();
  });

  it("tells an author without the right to delete so, beside the usage, and offers only Close", async () => {
    answer = () => envelope({ ...USED, mayDelete: false });
    show();
    expect(
      await screen.findByText(/You don't have permission to delete/)
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /then delete/ })).toBeNull();
  });

  it("says someone else is deleting it, and offers nothing to start", async () => {
    answer = () =>
      envelope({ ...USED, run: { yours: false, step: "converting" } });
    show();
    await shown(SOMEONE_ELSE_IS_DELETING);
    expect(screen.queryByRole("button", { name: /then delete/ })).toBeNull();
  });

  it("offers to resume the author's own paused delete", async () => {
    answer = () =>
      envelope({ ...USED, run: { yours: true, step: "converting" } });
    show();
    expect(
      await screen.findByRole("button", { name: "Resume delete" })
    ).toBeTruthy();
  });

  it("says the check failed in the refusal's own words, and checks again on Try again", async () => {
    let asked = 0;
    answer = () => {
      asked += 1;
      return asked === 1
        ? Promise.reject(new ApiError("The site is busy.", 500))
        : envelope(USED);
    };
    show();
    await shown("The site is busy.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Home")).toBeTruthy();
  });
});

describe("the delete", () => {
  it("calls the route again while the delete is under way, then says it is done", async () => {
    const steps = [
      result({
        status: "preflight",
        run: { yours: true, step: "preflight" },
      }),
      result({
        status: "running",
        run: { yours: true, step: "converting" },
        progress: { converted: 1, unchanged: 0, left: 0, pending: 2 },
      }),
      result({ status: "done", run: { yours: true, step: "settling" } }),
    ];
    answer = body =>
      body.dryRun === true ? envelope(USED) : envelope(steps.shift() ?? USED);
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    expect(
      await screen.findByText("Component deleted", undefined, {
        timeout: 4000,
      })
    ).toBeTruthy();
    expect(calls).toEqual([{ dryRun: true }, {}, {}, {}]);
    fireEvent.click(screen.getByRole("button", { name: "Back to Components" }));
    expect(handlers.onDeleted).toHaveBeenCalled();
  });

  it("shows the documents done of how many while it runs, and Pause stops calling the route", async () => {
    let stepped = 0;
    answer = body => {
      if (body.dryRun === true) return envelope(USED);
      stepped += 1;
      return envelope(
        result({
          status: "running",
          run: { yours: true, step: "converting" },
          progress: { converted: 2, unchanged: 1, left: 0, pending: 7 },
        })
      );
    };
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    expect(await screen.findByText("3 of 10 documents done")).toBeTruthy();
    expect(screen.getByText(MESSAGES.running)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("lists the documents a partly done delete left, and offers to try again", async () => {
    answer = body =>
      body.dryRun === true
        ? envelope(USED)
        : envelope(
            result({
              status: "partly-done",
              left: [
                {
                  document: {
                    kind: "collection",
                    slug: "pages",
                    id: "p1",
                    title: "Home",
                  },
                  reason: "pending-draft",
                  words: "It has unpublished changes.",
                },
              ],
              progress: { converted: 2, unchanged: 0, left: 1, pending: 0 },
            })
          );
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    await shown(MESSAGES.partlyDone);
    expect(screen.getByText("It has unpublished changes.")).toBeTruthy();
    expect(
      screen.getByText("2 documents turned into plain blocks.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says the author may not delete it when the start is refused with 403", async () => {
    answer = body =>
      body.dryRun === true
        ? envelope(USED)
        : Promise.reject(new ApiError("Forbidden", 403));
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    await shown("You don't have permission to delete this component.");
  });

  it("says someone else is deleting it when the start is refused with 409", async () => {
    answer = body =>
      body.dryRun === true
        ? envelope(USED)
        : Promise.reject(new ApiError(SOMEONE_ELSE_IS_DELETING, 409));
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Someone else is deleting this component",
      })
    ).toBeTruthy();
  });

  it("moves focus to the dialog's first button when the delete starts", async () => {
    answer = body =>
      body.dryRun === true
        ? envelope(USED)
        : envelope(
            result({
              status: "running",
              run: { yours: true, step: "converting" },
            })
          );
    show();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Turn each copy into plain blocks, then delete",
        })
      );
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Pause" })
      )
    );
  });
});

describe("checkedFace", () => {
  it("puts someone else's delete before every other answer", () => {
    expect(
      checkedFace({
        ...USED,
        mayDelete: false,
        status: "refused",
        run: { yours: false, step: "converting" },
      })
    ).toBe("someone-else");
  });

  it("reads a part-counted plan as counting, never as nothing used", () => {
    expect(
      checkedFace(
        result({
          status: "none",
          plan: {
            convert: NONE,
            drafts: NONE,
            mayBeRefused: 0,
            complete: false,
          } as ComponentDeleteResult["plan"],
        })
      )
    ).toBe("counting");
  });
});
