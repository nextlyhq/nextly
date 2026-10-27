/**
 * The frame every card wears: one title, the slots the customise controls use, and the five
 * states. These assert what a reader or a screen reader observes, so each would fail on a
 * plausible frame that, say, repeated the title, left a customised card's links reachable, or
 * offered Retry without calling it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CountValue } from "../archetypes/count-value";
import { frameIds } from "../frame/ids";
import { UNAVAILABLE_DETAIL, UNAVAILABLE_TITLE } from "../frame/states";
import { WidgetCard } from "../WidgetCard";

describe("the card frame", () => {
  it("titles every card with one h2, named by the card's id", () => {
    render(
      <WidgetCard title="Recent activity" cardId="c-1">
        <p>body</p>
      </WidgetCard>
    );
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveProperty("tagName", "H2");
    expect(headings[0]).toHaveAttribute("id", frameIds("c-1").titleId);
    expect(
      screen.getByRole("region", { name: "Recent activity" })
    ).toHaveAttribute("data-card-id", "c-1");
  });

  it("keeps its name when the card's id holds a space, and keeps two such ids apart", () => {
    // `aria-labelledby` reads a space as a separator, so an id spelled raw would point at two
    // elements that do not exist and the region would lose its name.
    render(
      <WidgetCard title="Recent activity" cardId="my card">
        <p>body</p>
      </WidgetCard>
    );
    expect(
      screen.getByRole("region", { name: "Recent activity" })
    ).toHaveAttribute("data-card-id", "my card");
    expect(frameIds("my card").titleId).not.toMatch(/\s/);
    // An id already spelled like an encoded one is a different card, so a different DOM id.
    expect(frameIds("my_20_card").titleId).not.toBe(
      frameIds("my card").titleId
    );
  });

  it("draws the leading slot before the title and the header action after it", () => {
    render(
      <WidgetCard
        title="Recent activity"
        leading={<button>Handle</button>}
        headerAction={<button>Menu</button>}
      >
        <p>body</p>
      </WidgetCard>
    );
    const [handle, title, menu] = [
      screen.getByRole("button", { name: "Handle" }),
      screen.getByRole("heading", { name: "Recent activity" }),
      screen.getByRole("button", { name: "Menu" }),
    ];
    expect(
      handle.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps a customised card's content visible but out of reach, title still shown once", () => {
    render(
      <WidgetCard
        title="Recent activity"
        customizing
        link={{ label: "View all", href: "/a" }}
        quick={<button>30 days</button>}
      >
        <a href="/x">An entry</a>
      </WidgetCard>
    );
    expect(screen.getByText("An entry").closest("[inert]")).not.toBeNull();
    expect(screen.getByText("View all").closest("[inert]")).not.toBeNull();
    // The quick setting is for using the card, not arranging it: it keeps its
    // place, so the header keeps its shape, and is out of reach.
    expect(screen.getByText("30 days").closest("[inert]")).not.toBeNull();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("shows a skeleton, marked busy, while data has never arrived", () => {
    render(
      <WidgetCard title="Posts" state={{ kind: "loading" }} skeleton="figure">
        <p>never shown</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("card-skeleton")).toHaveAttribute(
      "data-shape",
      "figure"
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.queryByText("never shown")).toBeNull();
    // Not a live region of its own: the grid's one live region announces the batch, and a
    // status per card would speak once for every card loading together.
    expect(
      screen
        .getByTestId("card-skeleton")
        .closest('[role="status"], [aria-live]')
    ).toBeNull();
  });

  it("says what an empty card will show, offers at most its one action, and keeps its footer link", () => {
    render(
      <WidgetCard
        title="Recent posts"
        state={{
          kind: "empty",
          empty: {
            title: "No posts yet",
            detail: "Your newest posts show here.",
            action: { label: "New post", href: "/posts/new" },
          },
        }}
        link={{ label: "View all posts", href: "/posts" }}
      >
        <p>never shown</p>
      </WidgetCard>
    );
    expect(screen.getByText("No posts yet")).toBeInTheDocument();
    // The empty state's one action (foundations R-4), and the footer's one
    // trailing link (R-1), which R-4 withholds only from a failed card: from an
    // empty one it still leads somewhere.
    expect(screen.getAllByRole("link").map(link => link.textContent)).toEqual([
      "New post",
      "View all posts",
    ]);
    expect(screen.getByRole("link", { name: "New post" })).toHaveAttribute(
      "href",
      "/posts/new"
    );
  });

  it("says not available in one fixed wording, with no action and no link", () => {
    render(
      <WidgetCard
        title="Usage backfill"
        state={{ kind: "no-access" }}
        link={{ label: "Open", href: "/u" }}
      >
        <p>never shown</p>
      </WidgetCard>
    );
    expect(screen.getByText(UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(UNAVAILABLE_DETAIL)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers Retry for this card in its error state, and calls it", () => {
    const onRetry = vi.fn();
    render(
      <WidgetCard
        title="Posts by status"
        state={{
          kind: "error",
          message: "The server didn't answer.",
          retry: onRetry,
        }}
      >
        <p>never shown</p>
      </WidgetCard>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry Posts by status" })
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Posts by status")).toBeInTheDocument();
  });

  it("offers no Retry when the caller cannot retry", () => {
    render(
      <WidgetCard
        title="Posts by status"
        state={{ kind: "error", message: "The server didn't answer." }}
      >
        <p>never shown</p>
      </WidgetCard>
    );
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

describe("a card's size tier", () => {
  /** Draws a card whose rendered width is `width`, holding one count of 1,248. */
  function drawAt(width: number) {
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width } as DOMRect);
    try {
      render(
        <WidgetCard title="Posts" cardId="c-tier">
          <CountValue total={1248} />
        </WidgetCard>
      );
    } finally {
      measure.mockRestore();
    }
  }

  it("is measured from the width the card is drawn at, and compacts a figure in a small card", () => {
    drawAt(300);

    expect(screen.getByRole("region", { name: "Posts" })).toHaveAttribute(
      "data-tier",
      "small"
    );
    // Drawn compact, heard in full.
    expect(screen.getByText("1.2k")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("1,248")).toHaveClass("sr-only");
  });

  it("shows the full figure in a card wide enough for it", () => {
    drawAt(900);

    expect(screen.getByRole("region", { name: "Posts" })).toHaveAttribute(
      "data-tier",
      "large"
    );
    expect(screen.getByText("1,248")).not.toHaveClass("sr-only");
    expect(screen.queryByText("1.2k")).toBeNull();
  });
});
