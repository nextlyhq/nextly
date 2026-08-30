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

  it("names the widget in the error's accessible role", () => {
    render(
      <WidgetCard title="Published posts" error="Source unavailable.">
        <p>42</p>
      </WidgetCard>
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Source unavailable.");
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
