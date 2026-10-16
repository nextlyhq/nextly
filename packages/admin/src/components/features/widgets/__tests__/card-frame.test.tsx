/**
 * The frame every card wears: one title, the slots the customise controls use, and the five
 * states. These assert what a reader or a screen reader observes, so each would fail on a
 * plausible frame that, say, repeated the title, left a customised card's links reachable, or
 * offered Retry without calling it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
        updatedAt={new Date()}
        quick={<button>30 days</button>}
      >
        <a href="/x">An entry</a>
      </WidgetCard>
    );
    expect(screen.getByText("An entry").closest("[inert]")).not.toBeNull();
    expect(screen.getByText("View all").closest("[inert]")).not.toBeNull();
    // The quick setting is for using the card, not arranging it.
    expect(screen.queryByRole("button", { name: "30 days" })).toBeNull();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("shows a skeleton, marked busy, while data has never arrived", () => {
    render(
      <WidgetCard title="Posts" state="loading" skeleton="figure">
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
  });

  it("says what an empty card will show and offers at most its one action", () => {
    render(
      <WidgetCard
        title="Recent posts"
        state="empty"
        empty={{
          title: "No posts yet",
          detail: "Your newest posts show here.",
          action: { label: "New post", href: "/posts/new" },
        }}
        link={{ label: "View all posts", href: "/posts" }}
      >
        <p>never shown</p>
      </WidgetCard>
    );
    expect(screen.getByText("No posts yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "New post" })).toHaveAttribute(
      "href",
      "/posts/new"
    );
  });

  it("says not available in one fixed wording, with no action and no link", () => {
    render(
      <WidgetCard
        title="Usage backfill"
        state="unavailable"
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
        error="The server didn't answer."
        onRetry={onRetry}
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
      <WidgetCard title="Posts by status" error="The server didn't answer.">
        <p>never shown</p>
      </WidgetCard>
    );
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});
