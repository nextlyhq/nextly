/**
 * The card is the one anatomy every widget wears, so these assert what a user
 * or a screen reader can observe about it, not which props were forwarded.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WidgetCard } from "../WidgetCard";

describe("WidgetCard", () => {
  it("renders the title and the body it was given", () => {
    render(
      <WidgetCard title="Published posts">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("marks the body busy while loading instead of swapping in a spinner", () => {
    render(
      <WidgetCard title="Published posts" isLoading>
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    // The body it already had is still there: loading is a state of the body,
    // not a replacement for it.
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not mark the body busy when it is not loading", () => {
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
      <WidgetCard title="Published posts" error="Source unavailable.">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.getByText("Source unavailable.")).toBeInTheDocument();
    // The error REPLACES the body rather than sitting beside a stale number.
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("shows the error as ordinary content, never as its own live region", () => {
    // `role="alert"` is assertive by definition, so a card that carried one
    // became its own interrupting announcer -- and a dashboard where five
    // widgets fail at once then produces five announcements over the top of the
    // grid's single polite one. The grid owns announcing for the batch.
    const { container } = render(
      <WidgetCard title="Published posts" error="Source unavailable.">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "Source unavailable."
    );
    expect(
      container.querySelectorAll('[role="alert"], [role="status"], [aria-live]')
    ).toHaveLength(0);
    // Still findable, by the landmark the title names.
    expect(
      screen.getByRole("region", { name: "Published posts" })
    ).toBeInTheDocument();
  });

  it("renders at most one footer link", () => {
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

  it("shows a freshness line when it has been told when the data landed", () => {
    render(
      <WidgetCard title="Published posts" updatedAt={new Date()}>
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-freshness")).toHaveTextContent(
      /updated just now/i
    );
  });

  it("does not claim fresh content on a card that is showing an error", () => {
    // The timestamp is when the BATCH landed, which is true of the request and
    // not of this card: "Updated just now" under "Source unavailable." tells
    // the reader the opposite of what happened.
    render(
      <WidgetCard
        title="Published posts"
        error="Source unavailable."
        updatedAt={new Date()}
      >
        <p>42</p>
      </WidgetCard>
    );
    expect(
      screen.queryByTestId("widget-card-freshness")
    ).not.toBeInTheDocument();
    // Nothing else is left behind either: with no link and no freshness there
    // is no footer to draw.
    expect(screen.queryByTestId("widget-card-footer")).not.toBeInTheDocument();
  });

  it("renders no footer at all when there is neither freshness nor a link", () => {
    render(
      <WidgetCard title="Published posts">
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.queryByTestId("widget-card-footer")).not.toBeInTheDocument();
  });

  it("drops the footer link while showing an error, so a broken card offers no dead end", () => {
    render(
      <WidgetCard
        title="Published posts"
        error="Source unavailable."
        link={{ label: "View all", href: "/dashboard/entries/posts" }}
      >
        <p>42</p>
      </WidgetCard>
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
