/**
 * The setup card's states, its row of tiles, its Singles and its controls, drawn from what the
 * card's `load` answered, and what each control writes.
 */
import type { SetupCardData, SetupStep } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import {
  CardCollapseContext,
  type CardCollapse,
} from "@admin/components/features/widgets/frame/collapse";
import { CardGrowContext } from "@admin/components/features/widgets/frame/grow";
import { cardBodyHeightPx } from "@admin/components/features/widgets/frame/measures";
import { CardHeightContext } from "@admin/components/features/widgets/frame/tier";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";

// What the card writes, as the route receives it.
const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { put },
}));
// The sample-content offer's state, as a case sets it.
const seed = vi.hoisted(() => ({
  status: { kind: "idle", template: { slug: "blog", label: "Blog" } } as
    | { kind: "loading" }
    | { kind: "hidden" }
    | { kind: "idle"; template: { slug: string; label: string } }
    | { kind: "seeding" }
    | { kind: "success"; result: unknown }
    | { kind: "declining" }
    | { kind: "error"; message: string; failed: "load" | "decline" },
  startSeed: vi.fn(),
  skip: vi.fn(),
}));
vi.mock("@admin/hooks/queries/useSeedStatus", () => ({
  useSeedStatus: () => seed,
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({
    data: {
      items: [
        { slug: "home", label: "Home page" },
        { slug: "about", label: "About" },
      ],
    },
  }),
}));

import {
  SETUP_BAR,
  SETUP_GAP,
  SETUP_ROW_BODY_PX,
  SETUP_TILE,
} from "./setup/measures";
import { SetupCard } from "./SetupCard";

const SINGLES = ["home", "about", "footer", "contact", "legal"];

const STEPS: SetupStep[] = [
  { kind: "sample", status: "open" },
  { kind: "collection", status: "done" },
  { kind: "entry", status: "open", collection: "posts" },
  {
    kind: "singles",
    status: "open",
    singles: SINGLES.map((slug, index) => ({ slug, filledIn: index < 2 })),
  },
  { kind: "invite", status: "open" },
];

function dataOf(patch: Partial<SetupCardData> = {}): SetupCardData {
  return {
    setup: {
      known: true,
      steps: STEPS,
      done: STEPS.filter(s => s.status !== "open").length,
      total: STEPS.length,
    },
    collapsed: false,
    allSet: false,
    ...patch,
  };
}

const retry = vi.fn();

function draw(
  data: SetupCardData,
  grow?: (px: number | undefined) => void,
  collapse?: CardCollapse
) {
  const body = (
    <SetupCard
      widgetId="core/setup"
      placementId="core/setup"
      settings={{}}
      size={{ w: 12, h: 2, tier: "large" }}
      data={data}
      refreshing={false}
      retry={retry}
    />
  );
  const grown =
    grow === undefined ? (
      body
    ) : (
      <CardGrowContext.Provider value={grow}>{body}</CardGrowContext.Provider>
    );
  // At the size core declares for it, 12 × 2, as the dashboard draws it.
  return render(
    <CardHeightContext.Provider value={2}>
      {inFrame(
        collapse === undefined ? (
          grown
        ) : (
          <CardCollapseContext.Provider value={collapse}>
            {grown}
          </CardCollapseContext.Provider>
        ),
        "Set up your project"
      )}
    </CardHeightContext.Provider>
  );
}

/** "N of M done", as the frame's header draws it beside the title. */
const headerCount = () => screen.getByTestId("widget-card-title-count");

/** The tiles, in order, by the step each draws. */
const tiles = () =>
  screen
    .getAllByRole("listitem")
    .filter(item => item.hasAttribute("data-setup-step"));

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({});
  retry.mockClear();
  seed.status = { kind: "idle", template: { slug: "blog", label: "Blog" } };
  seed.startSeed.mockClear();
  seed.skip.mockClear();
});

describe("the setup card", () => {
  it("draws one row of tiles with N of M done and a bar, never a vertical list", () => {
    draw(dataOf());
    expect(headerCount()).toHaveTextContent("1 of 5 done");
    // Read with the title, as the card's name.
    expect(
      screen.getByRole("region", { name: /Set up your project/ })
    ).toHaveAccessibleName("Set up your project, 1 of 5 done");
    const row = screen.getByRole("list", { name: "Setup steps" });
    // One column per step from 640 px, flowing in one row; two columns below.
    expect(row.className).toContain("grid-cols-2");
    expect(row.className).toContain("sm:grid-flow-col");
    expect(row.className).toContain("sm:auto-cols-fr");
    expect(tiles().map(tile => tile.dataset.setupStep)).toEqual([
      "sample",
      "collection",
      "entry",
      "singles",
      "invite",
    ]);
  });

  it("draws no heading of its own: the frame's title is the card's one", () => {
    draw(dataOf());
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("makes five Singles one tile, N of M filled in", () => {
    draw(dataOf());
    const singles = tiles().filter(t => t.dataset.setupStep === "singles");
    expect(singles).toHaveLength(1);
    expect(singles[0]).toHaveTextContent("Fill in your Singles");
    expect(singles[0]).toHaveTextContent("2 of 5 filled in");
  });

  it("opens a short list of the Singles on choosing that tile, each with its state and link", () => {
    const grow = vi.fn();
    draw(dataOf(), grow);
    const open = screen.getByRole("button", {
      name: "Open: Fill in your Singles",
    });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", {
      name: "Your Singles, 2 of 5 filled in",
    });
    const home = within(list).getByText("Home page").closest("li")!;
    expect(home).toHaveTextContent("Filled in");
    expect(
      within(home).getByRole("link", { name: "Edit: Home page" })
    ).toHaveAttribute("href", "/admin/singles/home");
    const footer = list.querySelector('[data-setup-single="footer"]')!;
    expect(footer).toHaveTextContent("Not filled in yet");
    fireEvent.click(open);
    expect(screen.queryByRole("list", { name: /Your Singles/ })).toBeNull();
  });

  it("fits 12 × 2 at rest: a thin bar over one row of fixed-height tiles, the count in the header", () => {
    // The body two rows give the card holds the bar, the gap and one tile, with nothing else.
    expect(SETUP_ROW_BODY_PX).toBeLessThanOrEqual(cardBodyHeightPx(2));
    const { container } = draw(dataOf());
    const body = screen.getByTestId("setup-card");
    expect(body).toHaveClass(SETUP_GAP.className);
    expect(container.querySelector(`.${SETUP_BAR.className}`)).not.toBeNull();
    for (const tile of tiles()) expect(tile).toHaveClass(SETUP_TILE.className);
    // Nothing but the bar, the row and nothing else is drawn in the body at rest.
    expect(body.children).toHaveLength(2);
  });

  it("asks the frame for no growth at rest, and grows only while the reader has the Singles' list open", () => {
    const grow = vi.fn();
    draw(dataOf(), grow);
    // At rest the card keeps its two rows: nothing moves as the dashboard loads.
    expect(grow).not.toHaveBeenCalledWith(expect.any(Number));
    fireEvent.click(
      screen.getByRole("button", { name: "Open: Fill in your Singles" })
    );
    expect(grow).toHaveBeenLastCalledWith(expect.any(Number));
    fireEvent.click(
      screen.getByRole("button", { name: "Hide: Fill in your Singles" })
    );
    expect(grow).toHaveBeenLastCalledWith(undefined);
  });

  it("links Add your first entry to a new entry of the first creatable collection, not the collections index", () => {
    draw(dataOf());
    expect(
      screen.getByRole("link", { name: "Add: Add your first entry" })
    ).toHaveAttribute("href", "/admin/collections/posts/create");
  });

  it("offers Skip on Fill in your Singles and Invite a teammate only, and writes the skip", async () => {
    draw(dataOf());
    const skips = screen.getAllByRole("button", { name: /^Skip/ });
    expect(skips.map(button => button.textContent)).toEqual([
      "Skip: Fill in your Singles",
      "Skip: Invite a teammate",
    ]);
    fireEvent.click(skips[1]!);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        skip: { kind: "invite", skipped: true },
      })
    );
    // The card asks for its data again, which the skip changed.
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });

  it("offers Restore on a skipped step, counted as done", async () => {
    const steps: SetupStep[] = [
      { kind: "collection", status: "done" },
      { kind: "invite", status: "skipped" },
      { kind: "entry", status: "open", collection: "posts" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 2, total: 3 } }));
    expect(headerCount()).toHaveTextContent("2 of 3 done");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore: Invite a teammate" })
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        skip: { kind: "invite", skipped: false },
      })
    );
  });

  it("collapses to one line, N of M done, writes it, and expands again", async () => {
    draw(dataOf());
    fireEvent.click(screen.getByRole("button", { name: "Collapse setup" }));
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    expect(screen.getByTestId("setup-progress")).toHaveTextContent(
      "1 of 5 done"
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", { collapsed: true })
    );
    const expand = screen.getByRole("button", { name: "Expand setup" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(expand).not.toBeDisabled());
    fireEvent.click(expand);
    expect(
      screen.getByRole("list", { name: "Setup steps" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
        collapsed: false,
      })
    );
  });

  it("draws the collapsed card as one line, Set up your project · N of M done, and has the frame draw it one row tall", () => {
    const setCollapsed = vi.fn();
    draw(dataOf({ collapsed: true }), undefined, {
      collapsed: true,
      setCollapsed,
    });
    // Asked of the frame before the paint, so the card is one row from its first frame.
    expect(setCollapsed).toHaveBeenLastCalledWith(true);
    const line = screen.getByTestId("setup-progress");
    expect(line).toHaveTextContent("Set up your project · 1 of 5 done");
    // One line: no bar, no tiles, nothing under it.
    expect(screen.getByTestId("setup-card").children).toHaveLength(2);
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    // Opened, the frame draws the card at its own rows again.
    fireEvent.click(screen.getByRole("button", { name: "Expand setup" }));
    expect(setCollapsed).toHaveBeenLastCalledWith(false);
  });

  it("never asks the frame to collapse a card that is all set or could not check setup", () => {
    const setCollapsed = vi.fn();
    draw(dataOf({ collapsed: true, setup: { known: false } }), undefined, {
      collapsed: false,
      setCollapsed,
    });
    expect(setCollapsed).not.toHaveBeenCalledWith(true);
  });

  it("is drawn collapsed when the reader left it collapsed, on any device", () => {
    draw(dataOf({ collapsed: true }));
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand setup" })
    ).toBeInTheDocument();
  });

  it("writes the dismissal on Dismiss", async () => {
    draw(dataOf());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss setup" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", { dismissed: true })
    );
  });

  it("says when a change could not be saved", async () => {
    put.mockRejectedValue(new Error("network"));
    draw(dataOf());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be saved"
    );
  });

  it("says You're all set, once every step is done", () => {
    draw(
      dataOf({
        allSet: true,
        setup: {
          known: true,
          steps: [{ kind: "collection", status: "done" }],
          done: 1,
          total: 1,
        },
      })
    );
    expect(screen.getByTestId("setup-all-set")).toHaveTextContent(
      "You're all set."
    );
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
  });

  it("says it could not check setup, with Retry, and shows no step open", () => {
    draw(dataOf({ setup: { known: false } }));
    expect(
      screen.getByText("We couldn't check your setup just now.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });

  it("leaves sample content out where the project's route says this reader cannot load it", () => {
    seed.status = { kind: "hidden" };
    draw(dataOf());
    expect(tiles().map(tile => tile.dataset.setupStep)).not.toContain("sample");
    // Counted over the tiles drawn.
    expect(headerCount()).toHaveTextContent("1 of 4 done");
  });

  it("keeps sample content as done once someone on the site answered it, whatever the route says now", () => {
    seed.status = { kind: "hidden" };
    const steps: SetupStep[] = [
      { kind: "sample", status: "done" },
      { kind: "entry", status: "open", collection: "posts" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    expect(tiles()[0]).toHaveAttribute("data-status", "done");
  });

  it("loads or declines sample content from its tile, and shows a failed run with Retry", () => {
    const { unmount } = draw(dataOf());
    const sample = tiles()[0]!;
    fireEvent.click(within(sample).getByRole("button", { name: "Load" }));
    expect(seed.startSeed).toHaveBeenCalledTimes(1);
    fireEvent.click(within(sample).getByRole("button", { name: "No thanks" }));
    expect(seed.skip).toHaveBeenCalledTimes(1);
    unmount();

    seed.status = {
      kind: "error",
      message: "Seed failed (500)",
      failed: "load",
    };
    draw(dataOf());
    const failed = tiles()[0]!;
    expect(within(failed).getByRole("alert")).toHaveTextContent(
      "Seed failed (500)"
    );
    fireEvent.click(within(failed).getByRole("button", { name: "Retry" }));
    expect(seed.startSeed).toHaveBeenCalledTimes(2);
  });

  it("draws sample content done only once the decline is confirmed, and asks for the card again then", () => {
    draw(dataOf());
    fireEvent.click(
      within(tiles()[0]!).getByRole("button", { name: "No thanks" })
    );
    // Not yet: the route has not confirmed it, and may refuse it.
    expect(tiles()[0]).toHaveAttribute("data-status", "open");
    expect(headerCount()).toHaveTextContent("1 of 5 done");
    expect(retry).not.toHaveBeenCalled();
    // The decline is recorded: done, counted, and the card asks for its steps as they now are.
    const [onRecorded] = seed.skip.mock.calls[0] as [() => void];
    act(() => onRecorded());
    expect(tiles()[0]).toHaveAttribute("data-status", "done");
    expect(headerCount()).toHaveTextContent("2 of 5 done");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps sample content open when the decline fails, says so, and Retry declines again", () => {
    const { rerender } = draw(dataOf());
    fireEvent.click(
      within(tiles()[0]!).getByRole("button", { name: "No thanks" })
    );
    // The decline failed: its confirmation never comes, and the offer says why.
    seed.status = {
      kind: "error",
      message: "Decline failed (500)",
      failed: "decline",
    };
    rerender(
      <CardHeightContext.Provider value={2}>
        {inFrame(
          <SetupCard
            widgetId="core/setup"
            placementId="core/setup"
            settings={{}}
            size={{ w: 12, h: 2, tier: "large" }}
            data={dataOf()}
            refreshing={false}
            retry={retry}
          />,
          "Set up your project"
        )}
      </CardHeightContext.Provider>
    );
    const sample = tiles()[0]!;
    expect(sample).toHaveAttribute("data-status", "open");
    expect(headerCount()).toHaveTextContent("1 of 5 done");
    expect(within(sample).getByRole("alert")).toHaveTextContent(
      "Couldn't save: Decline failed (500)"
    );
    fireEvent.click(within(sample).getByRole("button", { name: "Retry" }));
    expect(seed.skip).toHaveBeenCalledTimes(2);
    expect(seed.startSeed).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it("says You're all set over the steps it draws, and asks the host to record it with what the route said", async () => {
    // No sample route for this reader, and Invite skipped: one tile drawn, done.
    seed.status = { kind: "hidden" };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    expect(screen.getByTestId("setup-all-set")).toHaveTextContent(
      "You're all set."
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        retire: { sampleRefused: true },
      })
    );
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("asks no retirement while a step it draws is open", () => {
    // The must-differ half: the same steps where the route offers the load.
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    expect(screen.queryByTestId("setup-all-set")).toBeNull();
    expect(headerCount()).toHaveTextContent("1 of 2 done");
    expect(put).not.toHaveBeenCalled();
  });

  it("asks for the card again once per load that succeeds, however often it is drawn", () => {
    seed.status = { kind: "success", result: {} };
    const { rerender } = draw(dataOf());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(tiles()[0]).toHaveAttribute("data-status", "done");
    // Drawn again in the same place, as a refetch draws it: the same card, not a new one.
    rerender(
      <CardHeightContext.Provider value={2}>
        {inFrame(
          <SetupCard
            widgetId="core/setup"
            placementId="core/setup"
            settings={{}}
            size={{ w: 12, h: 2, tier: "large" }}
            data={dataOf()}
            refreshing={false}
            retry={retry}
          />,
          "Set up your project"
        )}
      </CardHeightContext.Provider>
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says a sample-content run is under way inside its tile", () => {
    seed.status = { kind: "seeding" };
    draw(dataOf());
    expect(within(tiles()[0]!).getByRole("status")).toHaveTextContent(
      "Loading sample content"
    );
  });
});
