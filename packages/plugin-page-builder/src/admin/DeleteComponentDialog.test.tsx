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
import { useState, type JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE_BUSY_REASON,
  type ComponentDeleteResult,
  type DeletePlan,
  type DocumentList,
} from "../component-delete/contract";
import { MESSAGES, SOMEONE_ELSE_IS_DELETING } from "../component-delete/words";

/** A request body, as the dialog sends it. */
interface Body {
  readonly dryRun?: true;
  readonly after?: string;
}

/** An error as the admin's API client throws it. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: { errors: { code: string; message: string }[] }
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
  // The issues as the admin's helper reads them, from `data.errors`.
  validationIssues: (error: unknown) =>
    (error as { data?: { errors?: { code: string }[] } }).data?.errors ?? [],
  usePluginRouteMutation: () => ({}),
}));

const { DeleteComponentDialog, checkedFace } = await import(
  "./DeleteComponentDialog"
);
const { addSlice, EMPTY_TALLY, tallyUses } = await import(
  "./component-delete-client"
);

const NONE: DocumentList = { named: [], unreadable: 0, more: 0 };

/** A dry run's plan: the whole site in one slice, unless said otherwise. */
function planOf(rest: Partial<DeletePlan> = {}): DeletePlan {
  return {
    complete: true,
    next: null,
    convert: NONE,
    drafts: NONE,
    ...rest,
  };
}

const HOME = {
  kind: "collection",
  slug: "pages",
  id: "p1",
  title: "Home",
} as const;
const PRICING = {
  kind: "collection",
  slug: "pages",
  id: "p2",
  title: "Pricing",
} as const;

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
  plan: planOf({
    convert: {
      named: [HOME, { kind: "single", slug: "site-footer", title: "Footer" }],
      unreadable: 1,
      more: 0,
    },
  }),
});

const handlers = { onClose: vi.fn(), onDeleted: vi.fn() };

/**
 * Whether `text` is on screen. The dialog's live region says some states in
 * the same words as the visible sentence, so more than one match is right.
 */
async function shown(text: string | RegExp): Promise<void> {
  expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
}

/** The dialog as a screen holds it: closing it closes it. */
function Host(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <DeleteComponentDialog
      componentId="c1"
      name="Hero"
      open={open}
      onClose={() => {
        handlers.onClose();
        setOpen(false);
      }}
      onDeleted={handlers.onDeleted}
      leaveLabel="Back to Components"
    />
  );
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
    await shown(/is used in 3 documents/);
    const home = screen.getByRole("link", { name: /^Home / });
    expect(home.getAttribute("href")).toBe("/admin/collections/pages/p1");
    expect(
      screen.getByRole("link", { name: /^Footer / }).getAttribute("href")
    ).toBe("/admin/singles/site-footer");
    expect(screen.getByText("and 1 document you can't view")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    ).toBeTruthy();
  });

  it("says which documents hold unpublished changes", async () => {
    answer = () =>
      envelope({
        ...USED,
        plan: planOf({
          convert: USED.plan?.convert ?? NONE,
          drafts: { named: [HOME], unreadable: 0, more: 0 },
        }),
      });
    show();
    expect(
      await screen.findByText(/1 document has unpublished changes/)
    ).toBeTruthy();
  });

  it("counts a converted document and a draft-only one together, and lists both", async () => {
    answer = () =>
      envelope(
        result({
          status: "used",
          plan: planOf({
            convert: { named: [HOME], unreadable: 0, more: 0 },
            drafts: { named: [PRICING], unreadable: 0, more: 0 },
          }),
        })
      );
    show();
    await shown(/is used in 2 documents\./);
    expect(screen.getByRole("link", { name: /^Home / })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Pricing / })).toBeTruthy();
  });

  it("offers a plain delete when nothing uses it", async () => {
    answer = () =>
      envelope(
        result({
          status: "none",
          plan: planOf(),
        })
      );
    show();
    await shown(/Nothing uses/);
    expect(
      screen.getByRole("button", { name: "Delete component" })
    ).toBeTruthy();
  });

  it("never says nothing uses it before the last slice, and asks for each slice from where the last stopped", async () => {
    // The second slice is held until the first has been read on screen.
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    answer = async body => {
      if (body.after === undefined) {
        return envelope(
          result({
            status: "counting",
            plan: planOf({ complete: false, next: "slice-2" }),
          })
        );
      }
      await held;
      return envelope(result({ status: "none", plan: planOf() }));
    };
    show();
    await shown(/Still checking where/);
    expect(screen.getByText("Checking… none found so far")).toBeTruthy();
    expect(screen.queryByText(/Nothing uses/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete component" })
    ).toBeNull();
    release();
    await shown(/Nothing uses/);
    expect(calls).toEqual([
      { dryRun: true },
      { dryRun: true, after: "slice-2" },
    ]);
  });

  it("adds each slice's documents up, saying at least how many while it reads, and offers the delete once every slice is read", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    answer = async body => {
      if (body.after === undefined) {
        return envelope(
          result({
            status: "used",
            plan: planOf({
              complete: false,
              next: "slice-2",
              convert: { named: [HOME], unreadable: 0, more: 0 },
            }),
          })
        );
      }
      await held;
      // The last slice found nothing of its own: the sum still uses it.
      return envelope(
        result({
          status: "none",
          plan: planOf({
            convert: { named: [PRICING], unreadable: 0, more: 0 },
          }),
        })
      );
    };
    show();
    expect(
      await screen.findByText(/is used in at least 1 document so far/)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /then delete/ })).toBeNull();
    release();
    await shown(/is used in 2 documents\./);
    expect(screen.getByRole("link", { name: /^Home / })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Pricing / })).toBeTruthy();
    expect(screen.queryByText(/Nothing uses/)).toBeNull();
    expect(screen.getByRole("button", { name: /then delete/ })).toBeTruthy();
  });

  it("shows a refusal a slice finds at once, reading no further", async () => {
    answer = () =>
      envelope(
        result({
          status: "refused",
          plan: planOf({ complete: false, next: "slice-2" }),
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
    expect(calls).toEqual([{ dryRun: true }]);
  });

  it("refuses with the Layouts that use it, and offers nothing to confirm", async () => {
    answer = () =>
      envelope(
        result({
          status: "refused",
          plan: planOf(),
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
    expect(screen.getByRole("link", { name: /^Main / })).toBeTruthy();
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
          plan: planOf(),
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
          // The route lists 50 at most and counts the rest.
          leftMore: 60,
        })
      );
    show();
    expect(
      await screen.findByText("Remove the component there by hand.")
    ).toBeTruthy();
    expect(screen.getByText(/A document you can.t view/)).toBeTruthy();
    expect(screen.getByText("No rights.")).toBeTruthy();
    expect(screen.getByText("and 60 more")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /then delete/ })).toBeNull();
  });

  it("tells an author without the right to delete so, beside the usage, and offers only Close", async () => {
    answer = () => envelope({ ...USED, mayDelete: false });
    show();
    await shown(/You don't have permission to delete/);
    expect(screen.getByRole("link", { name: /^Home / })).toBeTruthy();
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
      result({ status: "done", run: { yours: true, step: "deleted" } }),
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
    render(<Host />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    expect(await screen.findByText("3 of 10 documents done")).toBeTruthy();
    expect(screen.getByText(MESSAGES.running)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    // Between requests: once the step on its way has answered.
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
    // A step already sent may land; none is sent after it. Calling on would
    // send one every quarter second.
    const atPause = stepped;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 900));
    });
    expect(stepped).toBeLessThanOrEqual(atPause + 1);
  });

  it("waits for the step on its way when paused, and shows the delete done when that step finished it", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let stepped = 0;
    answer = async body => {
      if (body.dryRun === true) return envelope(USED);
      stepped += 1;
      if (stepped === 1) {
        return envelope(
          result({
            status: "running",
            run: { yours: true, step: "converting" },
            progress: { converted: 1, unchanged: 0, left: 0, pending: 1 },
          })
        );
      }
      await held;
      return envelope(
        result({ status: "done", run: { yours: true, step: "deleted" } })
      );
    };
    render(<Host />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    await waitFor(() => expect(stepped).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pausing = await screen.findByRole("button", { name: "Pausing…" });
    expect((pausing as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      release();
      await held;
    });
    expect(
      await screen.findByRole("heading", { name: "Component deleted" })
    ).toBeTruthy();
    expect(handlers.onClose).not.toHaveBeenCalled();
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
              leftMore: 3,
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
    expect(screen.getByText("and 3 more")).toBeTruthy();
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

  it("says the author may not delete it when a step part way is refused with 403, and what was converted before", async () => {
    let stepped = 0;
    answer = body => {
      if (body.dryRun === true) return envelope(USED);
      stepped += 1;
      if (stepped === 1) {
        return envelope(
          result({
            status: "running",
            run: { yours: true, step: "converting" },
            progress: { converted: 2, unchanged: 0, left: 0, pending: 1 },
          })
        );
      }
      return Promise.reject(new ApiError("Forbidden", 403));
    };
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    await shown("You don't have permission to delete this component.");
    expect(
      screen.getByText(
        "2 documents were turned into plain blocks before that. The component was kept."
      )
    ).toBeTruthy();
  });

  it("says what was already converted when a step part way fails", async () => {
    let stepped = 0;
    answer = body => {
      if (body.dryRun === true) return envelope(USED);
      stepped += 1;
      if (stepped === 1) {
        return envelope(
          result({
            status: "running",
            run: { yours: true, step: "converting" },
            progress: { converted: 2, unchanged: 0, left: 0, pending: 1 },
          })
        );
      }
      return Promise.reject(new ApiError("The site is busy.", 500));
    };
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    await shown("The site is busy.");
    expect(
      screen.getByText("2 documents were already turned into plain blocks.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("treats any other 409 as a failure to retry, in its own words", async () => {
    const refusal =
      "Components are deleted with Delete component, which turns their copies into plain blocks first. Use it instead.";
    answer = body =>
      body.dryRun === true
        ? envelope(USED)
        : Promise.reject(new ApiError(refusal, 409));
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    await shown(refusal);
    expect(
      screen.queryByRole("heading", { name: "Delete in progress" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("tells someone else's delete by the refusal's code, not its words", async () => {
    // The busy words with no busy code: an ordinary conflict, to retry.
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
      await screen.findByRole("button", { name: "Try again" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Delete in progress" })
    ).toBeNull();
  });

  it("says someone else is deleting it when the start is refused with the busy code", async () => {
    answer = body =>
      body.dryRun === true
        ? envelope(USED)
        : Promise.reject(
            new ApiError(SOMEONE_ELSE_IS_DELETING, 409, {
              errors: [
                { code: DELETE_BUSY_REASON, message: SOMEONE_ELSE_IS_DELETING },
              ],
            })
          );
    show();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn each copy into plain blocks, then delete",
      })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Delete in progress",
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

describe("tallyUses", () => {
  it("counts a document both converted and holding changes once, and one only holding changes too", () => {
    const tally = addSlice(
      EMPTY_TALLY,
      result({
        status: "used",
        plan: planOf({
          convert: { named: [HOME], unreadable: 0, more: 0 },
          drafts: { named: [HOME, PRICING], unreadable: 0, more: 0 },
        }),
      })
    );
    expect(tallyUses(tally)).toBe(2);
  });
});

describe("checkedFace", () => {
  it("puts someone else's delete before every other answer", () => {
    const answered = {
      ...USED,
      mayDelete: false,
      status: "refused" as const,
      run: { yours: false, step: "converting" },
    };
    expect(checkedFace(answered, addSlice(EMPTY_TALLY, answered))).toBe(
      "someone-else"
    );
  });

  it("reads slices that found nothing as counting until the last, never as nothing used", () => {
    const first = result({
      status: "counting",
      plan: planOf({ complete: false, next: "slice-2" }),
    });
    const tally = addSlice(EMPTY_TALLY, first);
    expect(checkedFace(first, tally)).toBe("counting");
    const last = result({ status: "none", plan: planOf() });
    expect(checkedFace(last, addSlice(tally, last))).toBe("none");
  });

  it("reads a used earlier slice as used, though the last slice found nothing", () => {
    const first = result({
      status: "used",
      plan: planOf({
        complete: false,
        next: "slice-2",
        convert: { named: [HOME], unreadable: 0, more: 0 },
      }),
    });
    const last = result({ status: "none", plan: planOf() });
    expect(
      checkedFace(last, addSlice(addSlice(EMPTY_TALLY, first), last))
    ).toBe("used");
  });
});
