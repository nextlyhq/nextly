/**
 * The setup card's states, its row of tiles, its Singles and its controls, drawn from what the
 * card's `load` answered, and what each control writes.
 */
import { QueryClient } from "@tanstack/react-query";
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
import { WIDGET_QUERIES_KEY } from "@admin/hooks/queries/widget-queries-key";
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
  setupOneRowPx,
  setupRowClass,
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

// The dashboard's answers asked for again in place, by the batch's own query.
const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
/** How many times the card asked the dashboard's answers again in place. */
const readInPlace = () =>
  invalidate.mock.calls.filter(
    ([filters]) =>
      JSON.stringify(filters?.queryKey) === JSON.stringify(WIDGET_QUERIES_KEY)
  ).length;

/** The card as the dashboard draws it, for `render` or a `rerender` with new data. */
function tree(
  data: SetupCardData,
  grow?: (px: number | undefined) => void,
  collapse?: CardCollapse,
  /** A newer answer is on its way, as the frame says while the card's data is read again. */
  refreshing = false
) {
  const body = (
    <SetupCard
      widgetId="core/setup"
      placementId="core/setup"
      settings={{}}
      size={{ w: 12, h: 2, tier: "large" }}
      data={data}
      refreshing={refreshing}
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
  return (
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

function draw(
  data: SetupCardData,
  grow?: (px: number | undefined) => void,
  collapse?: CardCollapse
) {
  return render(tree(data, grow, collapse));
}

/** "N of M done", as the frame's header draws it beside the title. */
const headerCount = () => screen.getByTestId("widget-card-title-count");

/** The frame's header, where the card's own controls are drawn beside its menu. */
const header = () => screen.getByTestId("widget-card-header");

/** A tile's hint line as it is drawn: what an eye reads, without what only a screen reader hears. */
function drawnHint(tile: HTMLElement): string {
  const line = tile.querySelector("[data-setup-actions]")!.parentElement!;
  const copy = line.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent ?? "";
}

/** The tile of `kind`. */
const tileOf = (kind: SetupStep["kind"]) =>
  tiles().find(tile => tile.dataset.setupStep === kind)!;

/** The tiles, in order, by the step each draws. */
const tiles = () =>
  screen
    .getAllByRole("listitem")
    .filter(item => item.hasAttribute("data-setup-step"));

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({});
  retry.mockClear();
  invalidate.mockClear();
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
    // One column per step, flowing in one row, where the body gives five tiles room to read in
    // full; two columns where it does not. Judged by the body's width, not the viewport's.
    expect(screen.getByTestId("setup-card")).toHaveClass("@container");
    expect(row).toHaveClass("grid-cols-2");
    expect(row).toHaveClass(`@min-[${setupOneRowPx(5)}px]:grid-flow-col`);
    expect(row).toHaveClass(`@min-[${setupOneRowPx(5)}px]:auto-cols-fr`);
    expect(row).toHaveClass(`@min-[${setupOneRowPx(5)}px]:grid-cols-none`);
    expect(tiles().map(tile => tile.dataset.setupStep)).toEqual([
      "sample",
      "collection",
      "entry",
      "singles",
      "invite",
    ]);
  });

  it("keeps the tiles in one row only where each gets the width to read in full", () => {
    // Written out per count, so each threshold is held to the one rule it is written from.
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const px = setupOneRowPx(count);
      expect(setupRowClass(count).split(" ").sort()).toEqual(
        [
          "grid-cols-2",
          `@min-[${px}px]:grid-flow-col`,
          `@min-[${px}px]:auto-cols-fr`,
          `@min-[${px}px]:grid-cols-none`,
        ].sort()
      );
    }
    // Four tiles in a 1024 px window's card (598 px) wrap; in a 1440 px one's (1012 px) they do not.
    expect(setupOneRowPx(4)).toBeGreaterThan(598);
    expect(setupOneRowPx(5)).toBeLessThan(1012);
    // More steps than the table holds: two columns, never a row too narrow to read.
    expect(setupRowClass(7)).toBe("grid-cols-2");
  });

  it("draws no heading of its own: the frame's title is the card's one", () => {
    draw(dataOf());
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("makes five Singles one tile, drawn N of M · Open · Skip and read N of M filled in", () => {
    draw(dataOf());
    const singles = tiles().filter(t => t.dataset.setupStep === "singles");
    expect(singles).toHaveLength(1);
    expect(singles[0]).toHaveTextContent("Fill in your Singles");
    // The design's short copy on the tile, so it reads in full at narrow widths.
    expect(drawnHint(singles[0]!)).toBe("2 of 5·Open·Skip");
    // The whole wording for assistive technology, and on hover.
    const spoken = within(singles[0]!).getByText("2 of 5 filled in");
    expect(spoken).toHaveClass("sr-only");
    expect(within(singles[0]!).getByText("2 of 5")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(spoken.parentElement).toHaveAttribute("title", "2 of 5 filled in");
  });

  it("reads Hide · Skip on the Singles tile while its list is open", () => {
    draw(dataOf());
    fireEvent.click(
      screen.getByRole("button", { name: "Open: Fill in your Singles" })
    );
    expect(drawnHint(tileOf("singles"))).toBe("2 of 5·Hide·Skip");
  });

  it("reads Invite · Skip on an open Invite a teammate, with no word before its actions", () => {
    draw(dataOf());
    // No "Optional": Skip says it can be skipped; and no "·" before the first action.
    expect(drawnHint(tileOf("invite"))).toBe("Invite·Skip");
    expect(tileOf("invite")).not.toHaveTextContent("Optional");
  });

  it("keeps Done on a done tile", () => {
    const steps: SetupStep[] = [
      { kind: "collection", status: "done" },
      { kind: "invite", status: "done" },
    ];
    draw(dataOf({ setup: { known: true, steps, done: 2, total: 2 } }));
    expect(drawnHint(tileOf("collection"))).toBe("Done");
    expect(drawnHint(tileOf("invite"))).toBe("Done");
  });

  it("draws collapse and dismiss in the frame's header while expanded, none beside the tiles", () => {
    draw(dataOf());
    const collapse = screen.getByRole("button", { name: "Collapse setup" });
    const dismiss = screen.getByRole("button", { name: "Dismiss setup" });
    for (const control of [collapse, dismiss]) {
      expect(header()).toContainElement(control);
      expect(screen.getByTestId("setup-card")).not.toContainElement(control);
    }
    // Collapse, then dismiss, in that order for the keyboard too.
    expect(
      collapse.compareDocumentPosition(dismiss) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The menu's own size, over the 24 px a target may be at least.
    expect(collapse).toHaveClass("size-7");
    expect(dismiss).toHaveClass("size-7");
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
    expect(headerCount()).toHaveTextContent("1 of 5 done");
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

  it("draws the collapsed card as the frame's header alone, its title, N of M done and its controls, one row tall", () => {
    const setCollapsed = vi.fn();
    draw(dataOf({ collapsed: true }), undefined, {
      collapsed: true,
      setCollapsed,
    });
    // Asked of the frame before the paint, so the card is one row from its first frame.
    expect(setCollapsed).toHaveBeenLastCalledWith(true);
    expect(header()).toHaveTextContent("Set up your project");
    expect(headerCount()).toHaveTextContent("1 of 5 done");
    for (const name of ["Expand setup", "Dismiss setup"]) {
      const control = screen.getByRole("button", { name });
      expect(header()).toContainElement(control);
      // The menu's size, as while expanded, so the pair does not change as the card collapses.
      expect(control).toHaveClass("size-7");
    }
    // One line: no bar, no tiles, nothing in the body.
    expect(screen.queryByTestId("setup-card")).toBeNull();
    expect(screen.getByTestId("widget-card-body")).toBeEmptyDOMElement();
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
    let land: (answer: unknown) => void = () => undefined;
    put.mockReturnValueOnce(
      new Promise(resolve => {
        land = resolve;
      })
    );
    draw(dataOf({ setup: { known: true, steps, done: 1, total: 2 } }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", {
        retire: { sampleRefused: true },
      })
    );
    // Not before the host has recorded it: until then the one tile is drawn, done.
    expect(screen.queryByTestId("setup-all-set")).toBeNull();
    expect(headerCount()).toHaveTextContent("1 of 1 done");
    act(() => land({}));
    expect(await screen.findByTestId("setup-all-set")).toHaveTextContent(
      "You're all set."
    );
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("draws the steps again, and never says it will not show again, when the host refuses the retirement", async () => {
    // The host finds a step open as it sees the site now (409): nothing recorded.
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    seed.status = { kind: "hidden" };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const data = dataOf({ setup: { known: true, steps, done: 1, total: 2 } });
    const { rerender } = draw(data);
    // The dashboard's answers are read again, once, in place (never the host's Retry, which
    // would unmount the card), to draw the steps as the host has them.
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setup-all-set")).toBeNull();
    expect(screen.queryByText(/won't show again/)).toBeNull();
    expect(
      screen.getByRole("list", { name: "Setup steps" })
    ).toBeInTheDocument();
    // A refusal is never asked again over the same answer, however often it is drawn.
    rerender(tree(data));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("asks once over a refusal the host keeps giving, however often the same steps are read again", async () => {
    // The host refuses every time: no preferences table, or a write it cannot record.
    const refusal = () =>
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      });
    put.mockImplementation(() => Promise.reject(refusal()));
    seed.status = { kind: "hidden" };
    const steps = (): SetupStep[] => [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const answer = () =>
      dataOf({ setup: { known: true, steps: steps(), done: 1, total: 2 } });
    const { rerender } = draw(answer());
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    // Each read hands a new object with the same steps: never a second request.
    for (let read = 0; read < 4; read += 1) {
      rerender(tree(answer()));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(put).toHaveBeenCalledTimes(1);
    expect(readInPlace()).toBe(1);
  });

  it("asks once more after a refusal when a new answer is all done, finished elsewhere before the read", async () => {
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    seed.status = { kind: "hidden" };
    const asked: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const data = dataOf({
      setup: { known: true, steps: asked, done: 1, total: 2 },
    });
    const { rerender } = draw(data);
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    // The read the refusal asked for answers all done again: Invite was finished on another
    // device meanwhile, so the card never draws a step open in between.
    rerender(
      tree(
        dataOf({
          setup: {
            known: true,
            steps: [
              { kind: "sample", status: "open" },
              { kind: "invite", status: "done" },
            ],
            done: 1,
            total: 2,
          },
        })
      )
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
      retire: { sampleRefused: true },
    });
  });

  it("asks again after a refusal once the steps read again had one open and it is then done", async () => {
    // The host finds a step open (409), and the card's next read agrees: Invite is open.
    put.mockRejectedValueOnce(
      Object.assign(new Error("Setup is not all set: a step is still open."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    seed.status = { kind: "hidden" };
    const done: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const { rerender } = draw(
      dataOf({ setup: { known: true, steps: done, done: 1, total: 2 } })
    );
    await waitFor(() => expect(readInPlace()).toBe(1));
    expect(retry).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    rerender(
      tree(
        dataOf({
          setup: {
            known: true,
            steps: [
              { kind: "sample", status: "open" },
              { kind: "invite", status: "open" },
            ],
            done: 0,
            total: 2,
          },
        })
      )
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(1);
    // The reader skips Invite on this card: every step drawn is done again, so it asks again.
    rerender(
      tree(dataOf({ setup: { known: true, steps: done, done: 1, total: 2 } }))
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
      retire: { sampleRefused: true },
    });
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

  it("puts the card back as the server holds it when a collapse fails, says so, and collapses on the next try", async () => {
    put.mockRejectedValueOnce(new Error("network"));
    draw(dataOf());
    fireEvent.click(screen.getByRole("button", { name: "Collapse setup" }));
    // The write failed: drawn expanded again, as the server still has it, and the header says so.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be saved"
    );
    expect(
      screen.getByRole("list", { name: "Setup steps" })
    ).toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: "Collapse setup" });
    await waitFor(() => expect(collapse).not.toBeDisabled());
    // Collapse again asks to collapse, not to expand.
    fireEvent.click(collapse);
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
        collapsed: true,
      })
    );
    const expand = screen.getByRole("button", { name: "Expand setup" });
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

  it("draws the server's answer once the collapse has landed and been read again, even when another device changed it in between", async () => {
    const { rerender } = draw(dataOf());
    fireEvent.click(screen.getByRole("button", { name: "Collapse setup" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", { collapsed: true })
    );
    // Landed: the card's data is asked for again, and the read is on its way.
    await waitFor(() => expect(retry).toHaveBeenCalled());
    rerender(tree(dataOf(), undefined, undefined, true));
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    // The read answers expanded: another device expanded it after this write landed.
    rerender(tree(dataOf({ collapsed: false }), undefined, undefined, false));
    expect(
      screen.getByRole("list", { name: "Setup steps" })
    ).toBeInTheDocument();
  });

  it("draws the server's answer again once it holds the reader's collapse, so a later change from elsewhere wins", async () => {
    const { rerender } = draw(dataOf());
    fireEvent.click(screen.getByRole("button", { name: "Collapse setup" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", { collapsed: true })
    );
    // The card's next read confirms it.
    rerender(tree(dataOf({ collapsed: true })));
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    // The same reader expands it on another device, and a refocus reads that here.
    rerender(tree(dataOf({ collapsed: false })));
    expect(
      screen.getByRole("list", { name: "Setup steps" })
    ).toBeInTheDocument();
    // Collapse then asks to collapse, from what is drawn, not from a stale choice.
    const collapse = screen.getByRole("button", { name: "Collapse setup" });
    await waitFor(() => expect(collapse).not.toBeDisabled());
    fireEvent.click(collapse);
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/dashboard/setup", {
        collapsed: true,
      })
    );
  });

  it("asks the host again to record all set after a failed write, on the card's next read, never in a loop", async () => {
    put.mockRejectedValueOnce(new Error("network"));
    seed.status = { kind: "hidden" };
    const steps: SetupStep[] = [
      { kind: "sample", status: "open" },
      { kind: "invite", status: "skipped" },
    ];
    const data = dataOf({ setup: { known: true, steps, done: 1, total: 2 } });
    const { rerender } = draw(data);
    const retire = { retire: { sampleRefused: true } };
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", retire)
    );
    // The failure lands, and the header says so.
    await waitFor(() =>
      expect(headerCount()).toHaveTextContent("could not be saved")
    );
    // Drawn again from the same answer: not asked again.
    rerender(tree(data));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(1);
    // The card's data read again, on a load or a refocus: asked again, and it lands.
    rerender(tree({ ...data }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/dashboard/setup", retire);
    // Landed: a later read asks nothing more.
    rerender(tree({ ...data }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("cuts short only a tile's detail: its links and buttons are never inside the clipped text", () => {
    draw(dataOf());
    for (const tile of tiles()) {
      const actions = within(tile).queryAllByRole("button");
      const links = within(tile).queryAllByRole("link");
      for (const control of [...actions, ...links]) {
        expect(control.closest(".truncate")).toBeNull();
      }
    }
    // The detail is the one part cut short, and the Singles tile keeps Open and Skip beside it.
    const singles = tileOf("singles");
    expect(
      within(singles).getByText("2 of 5").closest(".truncate")
    ).not.toBeNull();
    const kept = singles.querySelector("[data-setup-actions]")!;
    expect(
      within(kept as HTMLElement).getByRole("button", { name: /^Open/ })
    ).toBeInTheDocument();
    expect(
      within(kept as HTMLElement).getByRole("button", { name: /^Skip/ })
    ).toBeInTheDocument();
  });

  it("says a sample-content run is under way inside its tile", () => {
    seed.status = { kind: "seeding" };
    draw(dataOf());
    expect(within(tiles()[0]!).getByRole("status")).toHaveTextContent(
      "Loading sample content"
    );
  });
});
