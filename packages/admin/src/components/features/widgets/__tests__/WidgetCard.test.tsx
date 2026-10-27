/**
 * The card is the one anatomy every widget wears, so these assert what a user
 * or a screen reader can observe about it, not which props were forwarded.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FrameState, type CardState } from "../frame/card-state";
import { WidgetCard } from "../WidgetCard";

/** Every state the frame draws, each as the renderer hands it. */
const STATES: readonly CardState[] = [
  { kind: "loading" },
  { kind: "refreshing" },
  { kind: "ready" },
  { kind: "empty", empty: { title: "No posts yet" } },
  { kind: "error", message: "Source unavailable." },
  { kind: "no-access" },
];

describe("WidgetCard", () => {
  it("centres a state that says something in the body, and leaves the skeleton at the top", () => {
    // A card keeps its rows whatever it shows: empty, error and no access are centred in the
    // body both ways rather than left at its top-left with the rest of a tall card blank.
    for (const [state, drawn] of [
      [{ kind: "empty", empty: { title: "No posts yet" } }, "card-empty"],
      [{ kind: "error", message: "Source unavailable." }, "widget-card-error"],
      [{ kind: "no-access" }, "card-unavailable"],
    ] as const) {
      const { unmount } = render(
        <WidgetCard title="Published posts" state={state}>
          <p>42</p>
        </WidgetCard>
      );
      const centred = screen.getByTestId("card-state-centred");
      expect(centred).toHaveClass("items-center", "justify-center");
      expect(centred).toContainElement(screen.getByTestId(drawn));
      unmount();
    }
    // The must-differ half: the loading skeleton is not centred.
    render(
      <WidgetCard title="Published posts" state={{ kind: "loading" }}>
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.queryByTestId("card-state-centred")).toBeNull();
  });

  it("renders the title and the body it was given", () => {
    render(
      <WidgetCard title="Published posts">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("marks the body busy while refreshing instead of swapping in a spinner", () => {
    render(
      <WidgetCard title="Published posts" state={{ kind: "refreshing" }}>
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    // The body it already had is still there: refreshing is a state of the
    // body, not a replacement for it.
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not mark the body busy when it is ready", () => {
    render(
      <WidgetCard title="Published posts">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );
  });

  it("keeps the title when the body is an error, so the user knows which widget broke", () => {
    render(
      <WidgetCard
        title="Published posts"
        state={{ kind: "error", message: "Source unavailable." }}
      >
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.getByText("Source unavailable.")).toBeInTheDocument();
    // The error REPLACES the body rather than sitting beside a stale number.
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("shows the error as ordinary content, never as its own live region", () => {
    // The grid owns announcing for the batch; a card that announced its own
    // error would speak over the grid's one polite region.
    const { container } = render(
      <WidgetCard
        title="Published posts"
        state={{ kind: "error", message: "Source unavailable." }}
      >
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "Source unavailable."
    );
    expect(
      container.querySelectorAll('[role="alert"], [role="status"], [aria-live]')
    ).toHaveLength(0);
    expect(
      screen.getByRole("region", { name: "Published posts" })
    ).toBeInTheDocument();
  });

  it("renders at most one footer link, beside a drawn body", () => {
    render(
      <WidgetCard
        title="Published posts"
        link={{ label: "View all", href: "/dashboard/entries/posts" }}
      >
        <p>42</p>
      </WidgetCard>
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/dashboard/entries/posts");
  });

  it("drops the footer's link while the card is loading, failed or not available", () => {
    for (const state of STATES) {
      const { unmount } = render(
        <WidgetCard
          title="Published posts"
          state={state}
          link={{ label: "View all", href: "/dashboard/entries/posts" }}
        >
          <p>42</p>
        </WidgetCard>
      );
      // An empty card keeps its link: "View all" still leads somewhere. The footer itself is
      // always kept, so the card is one height whatever it shows.
      const keepsLink =
        state.kind === "ready" ||
        state.kind === "refreshing" ||
        state.kind === "empty";
      const footer = screen.getByTestId("widget-card-footer");
      expect(
        within(footer).queryByRole("link", { name: "View all" }) !== null,
        state.kind
      ).toBe(keepsLink);
      unmount();
    }
  });

  it("says nothing about when its data arrived, in any state", () => {
    // Every card's time was the batch's, the same on all of them; the page says
    // it once. A card that says it again repeats one fact many times.
    for (const state of STATES) {
      const { container, unmount } = render(
        <WidgetCard title="Published posts" state={state}>
          <p>42</p>
        </WidgetCard>
      );
      expect(container.querySelector("time"), state.kind).toBeNull();
      expect(container.textContent, state.kind).not.toMatch(/updated/i);
      unmount();
    }
  });

  it("renders the header action beside the title", () => {
    render(
      <WidgetCard title="Published posts" headerAction={<button>Menu</button>}>
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("labels the card region with its own title", () => {
    render(
      <WidgetCard title="Published posts">
        <p>42</p>
      </WidgetCard>
    );
    expect(
      screen.getByRole("region", { name: "Published posts" })
    ).toBeInTheDocument();
  });
});

describe("the header", () => {
  it("names the subject, with the widget's own name beneath it", () => {
    render(
      <WidgetCard title="Posts" subtitle="Count">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByRole("heading", { name: "Posts" })).toBeInTheDocument();
    expect(screen.getByTestId("widget-card-subtitle")).toHaveTextContent(
      "Count"
    );
    // The region is named by both, so two cards about one subject are told apart aloud.
    expect(
      screen.getByRole("region", { name: "Posts Count" })
    ).toBeInTheDocument();
  });

  it("draws no subtitle when the title is the widget's own name", () => {
    render(
      <WidgetCard title="Upcoming releases">
        <p>42</p>
      </WidgetCard>
    );
    expect(
      screen.queryByTestId("widget-card-subtitle")
    ).not.toBeInTheDocument();
  });

  it("fits a long title to one line and keeps all of it on hover and for assistive technology", () => {
    const title =
      "Every post this team has written for the spring product launch";
    render(
      <WidgetCard title={title}>
        <p>42</p>
      </WidgetCard>
    );
    const heading = screen.getByRole("heading", { name: title });
    expect(heading).toHaveClass("truncate");
    expect(heading).toHaveAttribute("title", title);
  });

  it("keeps one height and the same controls in every state", () => {
    // A row of cards lines up only if no state adds or removes a row from the
    // header or changes its height.
    for (const state of STATES) {
      const { unmount } = render(
        <WidgetCard
          title="Posts"
          subtitle="Count"
          state={state}
          quick={<button>Range</button>}
          headerAction={<button>Card menu</button>}
        >
          <p>42</p>
        </WidgetCard>
      );
      const header = screen.getByTestId("widget-card-header");
      expect(header, state.kind).toHaveClass("h-10", "shrink-0");
      expect(
        screen.getByRole("button", { name: "Card menu" }),
        state.kind
      ).toBeInTheDocument();
      expect(screen.getByText("Range"), state.kind).toBeInTheDocument();
      unmount();
    }
  });

  it("puts the quick control out of reach only while there is no answer yet", () => {
    const quickInState = (state: CardState) => {
      const { unmount } = render(
        <WidgetCard title="Posts" state={state} quick={<button>Range</button>}>
          <p>42</p>
        </WidgetCard>
      );
      const wrapper = screen.getByText("Range").parentElement;
      const inert = wrapper?.hasAttribute("inert") === true;
      unmount();
      return inert;
    };
    expect(quickInState({ kind: "loading" })).toBe(true);
    // A failed or empty card is answering: changing the question may well fill it.
    expect(quickInState({ kind: "error", message: "Failed." })).toBe(false);
    expect(
      quickInState({ kind: "empty", empty: { title: "No posts yet" } })
    ).toBe(false);
    expect(quickInState({ kind: "ready" })).toBe(false);
  });
});

describe("the frame's spacing", () => {
  it("pads every card 16 px and puts 12 px between header and body", () => {
    render(
      <WidgetCard title="Posts">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByRole("region", { name: "Posts" })).toHaveClass("p-4");
    expect(screen.getByTestId("widget-card-body")).toHaveClass("pt-3");
  });

  it("never makes its body a scroll container", () => {
    render(
      <WidgetCard title="Posts">
        <p>42</p>
      </WidgetCard>
    );
    const body = screen.getByTestId("widget-card-body");
    expect(body.className).not.toMatch(
      /overflow-(auto|scroll|y-auto|y-scroll)/
    );
  });
});

describe("a state the body reports", () => {
  it("stays marked busy while a new answer is on the way", () => {
    // The body reports the empty state it read from the last answer; the refetch is the frame's.
    render(
      <WidgetCard title="Posts" state={{ kind: "refreshing" }}>
        <FrameState
          state={{ kind: "empty", empty: { title: "No posts yet" } }}
        />
      </WidgetCard>
    );
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
  });

  it("retries with the body's current callback, though its message has not changed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <WidgetCard title="Posts">
        <FrameState
          state={{ kind: "error", message: "Unreadable.", retry: first }}
        />
      </WidgetCard>
    );
    rerender(
      <WidgetCard title="Posts">
        <FrameState
          state={{ kind: "error", message: "Unreadable.", retry: second }}
        />
      </WidgetCard>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("is drawn by the frame in the body's place, and named on the card", () => {
    render(
      <WidgetCard title="Posts">
        <FrameState
          state={{ kind: "empty", empty: { title: "No posts yet" } }}
        />
      </WidgetCard>
    );
    expect(screen.getByTestId("card-empty")).toHaveTextContent("No posts yet");
    expect(screen.getByRole("region", { name: "Posts" })).toHaveAttribute(
      "data-state",
      "empty"
    );
  });

  it("withholds the footer's link when the body reports an error", () => {
    render(
      <WidgetCard
        title="Posts"
        link={{ label: "View all", href: "/dashboard/entries/posts" }}
      >
        <FrameState state={{ kind: "error", message: "Unreadable." }} />
      </WidgetCard>
    );
    expect(
      within(screen.getByTestId("widget-card-footer")).queryByRole("link")
    ).toBeNull();
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "Unreadable."
    );
  });
});

describe("a card that hides when its data is empty", () => {
  const empty: CardState = { kind: "empty", empty: { title: "Nothing" } };

  it("marks itself for the grid to take out while its answer is empty", () => {
    render(
      <WidgetCard title="Needs attention" state={empty} hidesWhenEmpty>
        <p>rows</p>
      </WidgetCard>
    );
    expect(
      screen.getByRole("region", { name: "Needs attention" })
    ).toHaveAttribute("data-hidden-empty");
  });

  it("is never hidden while it is failed, not available or still loading", () => {
    for (const state of [
      { kind: "error", message: "Failed." },
      { kind: "no-access" },
      { kind: "loading" },
    ] satisfies CardState[]) {
      const { unmount } = render(
        <WidgetCard title="Needs attention" state={state} hidesWhenEmpty>
          <p>rows</p>
        </WidgetCard>
      );
      expect(
        screen.getByRole("region", { name: "Needs attention" }),
        state.kind
      ).not.toHaveAttribute("data-hidden-empty");
      unmount();
    }
  });

  it("stays in reach in customise mode, marked as hidden while empty", () => {
    render(
      <WidgetCard
        title="Needs attention"
        state={empty}
        hidesWhenEmpty
        customizing
      >
        <p>rows</p>
      </WidgetCard>
    );
    expect(
      screen.getByRole("region", { name: "Needs attention" })
    ).not.toHaveAttribute("data-hidden-empty");
    expect(screen.getByTestId("hidden-while-empty")).toHaveTextContent(
      "Hidden while empty"
    );
  });

  it("is not marked at all when its widget does not hide", () => {
    render(
      <WidgetCard title="Posts" state={empty}>
        <p>rows</p>
      </WidgetCard>
    );
    expect(screen.getByRole("region", { name: "Posts" })).not.toHaveAttribute(
      "data-hidden-empty"
    );
  });
});

describe("the loading card's reservation", () => {
  // The placeholders a list or table card holds while its first answer is out: the rows its
  // tier will draw, so the card does not jump from three placeholders to twenty rows.
  const placeholders = () =>
    [...screen.getByTestId("card-skeleton").children].filter(
      element => !element.classList.contains("sr-only")
    );

  it("holds the place of the rows the card's tier draws", () => {
    render(
      <WidgetCard
        title="Recent posts"
        state={{ kind: "loading" }}
        skeleton="rows"
        skeletonItems={8}
        tier="large"
      >
        body
      </WidgetCard>
    );
    expect(placeholders()).toHaveLength(8);
  });

  it("holds three at the small tier, as the small card draws", () => {
    render(
      <WidgetCard
        title="Recent posts"
        state={{ kind: "loading" }}
        skeleton="rows"
        skeletonItems={8}
        tier="small"
      >
        body
      </WidgetCard>
    );
    expect(placeholders()).toHaveLength(3);
  });
});
