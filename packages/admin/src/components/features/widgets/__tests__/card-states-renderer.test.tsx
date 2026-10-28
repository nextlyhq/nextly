/**
 * How a widget's answer becomes one of the frame's states. Each test separates the right state
 * from the plausible wrong one: "not available" drawn as an error with Retry, an empty list
 * drawn as a blank body, a first load drawn as an empty busy card.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { UNAVAILABLE_TITLE } from "../frame/states";
import { resolveWidgetOutcome } from "../outcome";
import { WidgetRenderer } from "../WidgetRenderer";
import { gridBounds } from "./grid-bounds";

const list: DashboardWidget = {
  id: "core/recent-posts",
  title: "Recent posts",
  archetype: "list",
  size: gridBounds(4),
  query: { source: "collection:posts", op: "list", select: ["title"] },
};

const unavailable: WidgetSlot = {
  ok: false,
  error: "Invalid widget query: unavailable source or unsupported op",
  code: "unavailable",
};

describe("card states from a widget's answer", () => {
  it("draws a source that is not available as the one unavailable state, without Retry", () => {
    expect(resolveWidgetOutcome(list, unavailable)).toEqual({
      state: "unavailable",
    });
    render(
      <WidgetRenderer definition={list} slot={unavailable} onRetry={() => {}} />
    );
    expect(screen.getByText(UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("keeps the declaration's description out of the header, which holds the title alone", () => {
    // A description is what the add panel offers a widget by; the header is
    // one fixed height, the subject and at most the widget's own name.
    render(
      <WidgetRenderer
        definition={{ ...list, description: "Newest first" }}
        slot={{ ok: true, result: { op: "list", items: [{ title: "Hello" }] } }}
      />
    );
    expect(screen.queryByText("Newest first")).toBeNull();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("draws any other failure as an error with Retry", () => {
    const failed: WidgetSlot = {
      ok: false,
      error: "This widget took too long to answer",
    };
    expect(resolveWidgetOutcome(list, failed)).toEqual({
      state: "failed",
      message: "This widget took too long to answer",
    });
    render(
      <WidgetRenderer definition={list} slot={failed} onRetry={() => {}} />
    );
    expect(
      screen.getByRole("button", { name: "Retry Recent posts" })
    ).toBeInTheDocument();
  });

  it("asks for a setting the widget needs as its empty state, not as an error", () => {
    const needs: WidgetSlot = {
      ok: false,
      error: "Choose Collection in the card's settings",
      code: "needs-setting",
      setting: "Collection",
    };
    expect(resolveWidgetOutcome(list, needs)).toEqual({
      state: "empty",
      empty: {
        title: "Choose Collection in the card's settings",
        action: { label: "Choose collection", opensSettings: true },
      },
    });
    render(
      <WidgetRenderer definition={list} slot={needs} onRetry={() => {}} />
    );
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "Choose Collection in the card's settings"
    );
    // Retrying would ask the same unanswerable question again.
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    // And with no way to open the card's settings here, no button that would.
    expect(
      screen.queryByRole("button", { name: "Choose collection" })
    ).toBeNull();
  });

  it("opens the card's settings from a missing setting's empty state, in one click", async () => {
    const needs: WidgetSlot = {
      ok: false,
      error: "Choose Collection in the card's settings",
      code: "needs-setting",
      setting: "Collection",
    };
    const open = vi.fn();
    render(
      <WidgetRenderer definition={list} slot={needs} onOpenSettings={open} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose collection" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("takes a card its widget does not show for this person off the dashboard", () => {
    const notShown: WidgetSlot = {
      ok: false,
      error: "Not shown for you",
      code: "not-shown",
    };
    expect(resolveWidgetOutcome(list, notShown)).toEqual({
      state: "not-shown",
    });
    render(
      <WidgetRenderer definition={list} slot={notShown} onRetry={() => {}} />
    );
    expect(
      screen.getByRole("region", { name: "Recent posts" })
    ).toHaveAttribute("data-hidden-empty");
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("draws a list with no rows as the frame's empty state", () => {
    const empty: WidgetSlot = { ok: true, result: { op: "list", items: [] } };
    expect(resolveWidgetOutcome(list, empty)).toMatchObject({ state: "empty" });
    render(<WidgetRenderer definition={list} slot={empty} />);
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
  });

  it("draws a first load as a skeleton shaped like the archetype's body", () => {
    render(<WidgetRenderer definition={list} slot={undefined} />);
    expect(screen.getByTestId("card-skeleton")).toHaveAttribute(
      "data-shape",
      "rows"
    );
  });
});

describe("an empty card whose declared action opens its settings", () => {
  const note: DashboardWidget = {
    id: "core/note",
    title: "Note",
    archetype: "custom",
    size: gridBounds(4),
    serverData: true,
    component: "core#Note",
    declaredEmpty: {
      title: "Nothing written yet.",
      action: { label: "Write a note", opensSettings: true },
    },
  };
  const empty: WidgetSlot = {
    ok: true,
    empty: true,
    result: { op: "data", data: { text: "" } },
  };

  it("draws a button that opens them, where the card can", () => {
    const open = vi.fn();
    render(
      <WidgetRenderer definition={note} slot={empty} onOpenSettings={open} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Write a note" }));
    expect(open).toHaveBeenCalledOnce();
    // A button, not a link somewhere: the settings are the card's own.
    expect(screen.queryByRole("link", { name: "Write a note" })).toBeNull();
  });

  it("draws the words alone where the card cannot open them", () => {
    // A preview, or a reader who cannot change this card: no step they cannot take.
    render(<WidgetRenderer definition={note} slot={empty} />);
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "Nothing written yet."
    );
    expect(screen.queryByRole("button", { name: "Write a note" })).toBeNull();
  });
});
