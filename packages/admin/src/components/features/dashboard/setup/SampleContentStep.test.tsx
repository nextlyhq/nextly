/**
 * Sample content on the setup card, through the real route client (`seedApi`) with its `fetch`
 * answered here, and core's `PUT /api/dashboard/setup` stood in for: who is offered a load, a run
 * and every outcome kept across the card being drawn again, exactly one request per load, the
 * unfinished-run message, Try again's confirmation, recording on its own, a sibling check failing
 * mid-run, and Continue drawing the steps as they are now.
 */
import type { SampleRun, SetupCardData, SetupStep } from "nextly/config";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { CardHeightContext } from "@admin/components/features/widgets/frame/tier";
import {
  act,
  createTestQueryClient,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { put } }));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({ data: { items: [] } }),
}));

import { SetupCard } from "../SetupCard";

const STARTED = "2020-01-01T09:30:00.000Z";

function dataOf(
  sample: SetupStep | undefined,
  entry: SetupStep = { kind: "entry", status: "open", collection: "posts" }
): SetupCardData {
  const steps: SetupStep[] = [
    ...(sample === undefined ? [] : [sample]),
    { kind: "collection", status: "done" },
    entry,
  ];
  return {
    setup: {
      known: true,
      steps,
      done: steps.filter(step => step.status !== "open").length,
      total: steps.length,
    },
    collapsed: false,
    allSet: false,
  };
}

const OPEN: SetupStep = { kind: "sample", status: "open" };
const withRun = (run: SampleRun): SetupStep => ({
  kind: "sample",
  status: "open",
  run,
});

const retry = vi.fn();

function card(data: SetupCardData, refreshing = false): ReactElement {
  return (
    <CardHeightContext.Provider value={2}>
      {inFrame(
        <SetupCard
          widgetId="core/setup"
          placementId="core/setup"
          settings={{}}
          size={{ w: 12, h: 2, tier: "large" }}
          data={data}
          refreshing={refreshing}
          retry={retry}
        />,
        "Set up your project"
      )}
    </CardHeightContext.Provider>
  );
}

/** The route's answers: the probe by `probe`, and each POST by the next of `starts`. */
function route(
  probe: () => Response | Promise<Response>,
  ...starts: Array<() => Response | Promise<Response>>
) {
  const posts: RequestInit[] = [];
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") return probe();
      posts.push(init ?? {});
      const next = starts.shift();
      if (next === undefined) throw new Error("an unexpected second load");
      return next();
    }
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return posts;
}

const allowed = () =>
  new Response(null, {
    status: 200,
    headers: {
      "x-nextly-seed-template": "blog",
      "x-nextly-seed-template-label": "Blog",
    },
  });

const sampleTile = () =>
  document.querySelector<HTMLElement>('[data-setup-step="sample"]');
const panel = () =>
  document.querySelector<HTMLElement>("[data-setup-sample-panel]");
/** The panel once it is drawn: the run's state lands through the query cache, a tick later. */
const shownPanel = () =>
  waitFor(() => {
    const drawn = panel();
    if (drawn === null) throw new Error("no sample-content panel yet");
    return drawn;
  });
/** Waits until the panel's `role` element says `text`. */
const panelSays = (role: "status" | "alert", text: string | RegExp) =>
  waitFor(() =>
    expect(
      within(panel() ?? document.createElement("div")).getByRole(role)
    ).toHaveTextContent(text)
  );

const originalFetch = global.fetch;
beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({});
  retry.mockClear();
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("who is offered sample content", () => {
  it("offers Load and No thanks on a 2xx probe only", async () => {
    route(allowed);
    render(card(dataOf(OPEN)));
    const tile = sampleTile()!;
    expect(
      await within(tile).findByRole("button", { name: "Load" })
    ).toBeInTheDocument();
    expect(
      within(tile).getByRole("button", { name: "No thanks" })
    ).toBeInTheDocument();
  });

  it.each([
    ["refuses the person (401)", () => new Response(null, { status: 401 })],
    ["refuses the person (403)", () => new Response(null, { status: 403 })],
    ["is not there (404)", () => new Response(null, { status: 404 })],
    ["fails (503)", () => new Response(null, { status: 503 })],
    [
      "cannot be reached",
      () => {
        throw new Error("network");
      },
    ],
  ])("offers nothing when the route %s", async (_name, probe) => {
    route(probe);
    render(card(dataOf(OPEN)));
    await waitFor(() => expect(sampleTile()).toBeNull());
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
  });

  it("offers no load where the site's answer could not be read, and keeps Add your first entry", async () => {
    route(allowed);
    render(card(dataOf({ kind: "sample", status: "open", unreadable: true })));
    expect(
      await within(sampleTile()!).findByText("Couldn't check")
    ).toBeInTheDocument();
    // Given time for the probe, still no offer.
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
    expect(screen.getByRole("link", { name: /^Add/ })).toHaveAttribute(
      "href",
      expect.stringContaining("posts")
    );
  });

  it("asks for the site's current answer whenever the dashboard regains focus", async () => {
    route(allowed);
    render(card(dataOf(OPEN)));
    await within(sampleTile()!).findByRole("button", { name: "Load" });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("a load and its outcome", () => {
  it("keeps the run on the card when it is drawn again during and after the load, with one request", async () => {
    let land: (res: Response) => void = () => undefined;
    const posts = route(
      allowed,
      () =>
        new Promise<Response>(resolve => {
          land = resolve;
        })
    );
    const queryClient = createTestQueryClient();
    const first = render(card(dataOf(OPEN)), { queryClient });
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "Load" })
    );
    await panelSays("status", "Loading sample content");
    // Drawn again mid-run, as customise mode draws it: the run is still on show.
    first.unmount();
    const second = render(card(dataOf(OPEN)), { queryClient });
    expect(within(await shownPanel()).getByRole("status")).toHaveTextContent(
      "Loading sample content"
    );
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
    // Its answer lands though the card that asked is gone.
    await act(async () =>
      land(Response.json({ outcome: "loaded", result: {} }))
    );
    await panelSays("status", "Sample content loaded.");
    second.unmount();
    render(card(dataOf(OPEN)), { queryClient });
    expect(
      await screen.findByRole("button", { name: "Continue" })
    ).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });

  it("makes exactly one request for a failed load, says what failed, and offers Add your first entry", async () => {
    const posts = route(allowed, () =>
      Response.json(
        {
          outcome: "failed",
          failure: "post hello-world: media missing",
          startedAt: STARTED,
          errors: [{ message: "post hello-world: media missing" }],
        },
        { status: 500 }
      )
    );
    render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "Load" })
    );
    expect(
      await within(await shownPanel()).findByRole("alert")
    ).toHaveTextContent(
      "Loading sample content failed: post hello-world: media missing"
    );
    expect(
      within(await shownPanel()).getByRole("link", {
        name: "Add your first entry",
      })
    ).toBeInTheDocument();
    // Nothing is asked again on its own, however long the card shows the failure.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(posts).toHaveLength(1);
  });

  it("loads again only once the person confirms, after warning that some content may be there", async () => {
    const posts = route(allowed, () => Response.json({ outcome: "loaded" }));
    render(
      card(
        dataOf(
          withRun({ state: "failed", startedAt: STARTED, failure: "boom" })
        )
      )
    );
    fireEvent.click(
      await within(await shownPanel()).findByRole("button", {
        name: "Try again",
      })
    );
    expect(posts).toHaveLength(0);
    await panelSays("alert", "Some sample content may already be there");
    // Cancel loads nothing.
    fireEvent.click(
      within(await shownPanel()).getByRole("button", { name: "Cancel" })
    );
    expect(posts).toHaveLength(0);
    fireEvent.click(
      await within(await shownPanel()).findByRole("button", {
        name: "Try again",
      })
    );
    fireEvent.click(
      await within(await shownPanel()).findByRole("button", {
        name: "Load again",
      })
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toBe(JSON.stringify({ confirm: true }));
  });

  it("offers no Try again on a failed load once the site holds an entry", async () => {
    route(allowed);
    render(
      card(
        dataOf(
          withRun({ state: "failed", startedAt: STARTED, failure: "boom" }),
          { kind: "entry", status: "done" }
        )
      )
    );
    expect(
      await within(await shownPanel()).findByRole("alert")
    ).toHaveTextContent("Loading sample content failed: boom");
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says a load started at its time has not finished, starts nothing else, and offers Add your first entry", async () => {
    const posts = route(allowed);
    render(card(dataOf(withRun({ state: "unfinished", startedAt: STARTED }))));
    const message = await within(await shownPanel()).findByRole("status");
    expect(message).toHaveTextContent(/A load started at .+ has not finished/);
    expect(message).toHaveTextContent("2020");
    expect(
      within(message).getByRole("link", { name: "Add your first entry" })
    ).toBeInTheDocument();
    await act(async () => undefined);
    for (const name of ["Load", "Try again", "No thanks", "Continue"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(posts).toHaveLength(0);
  });

  it("says loaded but not recorded, and its Try again records without loading again", async () => {
    const posts = route(allowed, () =>
      Response.json({
        outcome: "unrecorded",
        run: "run-1",
        startedAt: STARTED,
        result: {},
      })
    );
    render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "Load" })
    );
    expect(
      await within(await shownPanel()).findByRole("alert")
    ).toHaveTextContent(
      "The sample content loaded, but recording that failed."
    );
    // Neither the offer again nor a way on as if it were recorded.
    for (const name of ["Load", "No thanks", "Continue"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    put.mockRejectedValueOnce(
      Object.assign(new Error("An unexpected error occurred."), {
        status: 500,
        code: "INTERNAL_ERROR",
      })
    );
    fireEvent.click(
      within(await shownPanel()).getByRole("button", { name: "Try again" })
    );
    await panelSays("alert", "recording that failed again");
    fireEvent.click(
      await within(await shownPanel()).findByRole("button", {
        name: "Try again",
      })
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
      sample: { record: "run-1" },
    });
    expect(posts).toHaveLength(1);
  });

  it("records a load the site holds as not recorded from another session, by its run", async () => {
    route(allowed);
    render(
      card(
        dataOf(
          withRun({ state: "unrecorded", startedAt: STARTED, run: "run-9" })
        )
      )
    );
    fireEvent.click(
      await within(await shownPanel()).findByRole("button", {
        name: "Try again",
      })
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        sample: { record: "run-9" },
      })
    );
  });

  it("says a load is already in progress when the route refuses the start, and asks for the card again", async () => {
    route(allowed, () =>
      Response.json(
        {
          outcome: "refused",
          reason: "in-progress",
          errors: [
            { message: "A sample-content load is already in progress." },
          ],
        },
        { status: 409 }
      )
    );
    render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "Load" })
    );
    expect(
      await within(await shownPanel()).findByRole("alert")
    ).toHaveTextContent("A sample-content load is already in progress.");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the run on show when the other steps' check fails, with that failure and its own Retry", async () => {
    route(allowed, () => Response.json({ outcome: "loaded" }));
    const { rerender } = render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "Load" })
    );
    await within(await shownPanel()).findByText(/Sample content loaded/);
    // The card's next read could not check setup.
    rerender(
      card({ setup: { known: false }, collapsed: false, allSet: false })
    );
    expect(within(await shownPanel()).getByRole("status")).toHaveTextContent(
      "Sample content loaded."
    );
    const failed = (await shownPanel()).querySelector<HTMLElement>(
      "[data-setup-refresh-failed]"
    )!;
    expect(failed).toHaveTextContent("We couldn't check your other steps");
    fireEvent.click(within(failed).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("We couldn't check your setup just now.")
    ).toBeNull();
  });

  it("shows the steps as they are now after Continue, never a stale cached answer", async () => {
    route(allowed, () => Response.json({ outcome: "loaded" }));
    const { rerender } = render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "Load" })
    );
    fireEvent.click(
      await within(await shownPanel()).findByRole("button", {
        name: "Continue",
      })
    );
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    // The cache answers first with the answer from before the load: not drawn as the offer.
    rerender(card(dataOf(OPEN), true));
    await panelSays("status", "Checking your steps…");
    rerender(card(dataOf(OPEN)));
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
    // The site's answer now: sample content and the first entry done.
    rerender(
      card(
        dataOf(
          { kind: "sample", status: "done" },
          {
            kind: "entry",
            status: "done",
          }
        )
      )
    );
    await waitFor(() => expect(panel()).toBeNull());
    expect(document.querySelector('[data-setup-step="entry"]')).toHaveAttribute(
      "data-status",
      "done"
    );
  });
});

describe("declining", () => {
  it("declines for the site through core, drawn done once confirmed, and asks for the card again", async () => {
    let land: () => void = () => undefined;
    put.mockReturnValueOnce(
      new Promise<void>(resolve => {
        land = resolve;
      })
    );
    route(allowed);
    render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "No thanks" })
    );
    expect(put).toHaveBeenCalledWith("/dashboard/setup", { sample: "decline" });
    expect(sampleTile()).toHaveAttribute("data-status", "open");
    await act(async () => land());
    await waitFor(() =>
      expect(sampleTile()).toHaveAttribute("data-status", "done")
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says why when the site's answer moved on, and keeps the step as the site has it", async () => {
    put.mockRejectedValueOnce(
      Object.assign(
        new Error("Someone has already loaded or declined sample content."),
        { status: 409, code: "CONFLICT" }
      )
    );
    route(allowed);
    render(card(dataOf(OPEN)));
    fireEvent.click(
      await within(sampleTile()!).findByRole("button", { name: "No thanks" })
    );
    expect(
      await within(await shownPanel()).findByRole("alert")
    ).toHaveTextContent(
      "Someone has already loaded or declined sample content."
    );
    expect(sampleTile()).toHaveAttribute("data-status", "open");
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
