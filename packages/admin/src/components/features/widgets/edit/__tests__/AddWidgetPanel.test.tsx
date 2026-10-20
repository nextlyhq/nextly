/**
 * The add panel as a reader meets it: where focus starts, how its groups read, what a search
 * keeps and says, and what each row's button does.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_PLACEMENTS } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AddPanelRow } from "../add-panel-model";
import { AddWidgetPanel, type AddWidgetPanelProps } from "../AddWidgetPanel";

const ROWS: AddPanelRow[] = [
  {
    key: "removed:p9",
    section: "removed",
    name: "Old notes",
    description: "Comes back where it was, with its width and settings.",
    placed: 0,
    action: { kind: "add-back", placementId: "p9" },
  },
  {
    key: "core/entries",
    section: "overview",
    name: "Entries",
    description: "How many entries there are.",
    category: "Content",
    widths: "¼ to Full wide",
    placed: 0,
    action: { kind: "add", widgetId: "core/entries" },
  },
  {
    key: "core/recent",
    section: "overview",
    name: "Recent activity",
    widths: "½ to Full wide",
    placed: 2,
    action: { kind: "add-another", widgetId: "core/recent" },
  },
  {
    key: "core/team",
    section: "team",
    name: "Team members",
    placed: 1,
    action: { kind: "on-dashboard" },
  },
  {
    key: "seo/score",
    section: "plugins",
    subgroup: "SEO",
    name: "SEO score",
    placed: 0,
    action: { kind: "add", widgetId: "seo/score" },
  },
];

function renderPanel(props: Partial<AddWidgetPanelProps> = {}) {
  const all: AddWidgetPanelProps = {
    open: true,
    onOpenChange: vi.fn(),
    rows: ROWS,
    atCapacity: false,
    onAdd: vi.fn(() => ({ title: "Entries", position: 4, count: 4 })),
    onAddBack: vi.fn(() => ({ title: "Old notes", position: 2, count: 4 })),
    onClosed: vi.fn(),
    ...props,
  };
  render(<AddWidgetPanel {...all} />);
  return all;
}

function panel(): HTMLElement {
  return screen.getByRole("dialog", { name: "Add widget" });
}

function live(): HTMLElement {
  return screen.getByTestId("add-panel-live");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("opening", () => {
  it("is a dialog named Add widget, with focus in an empty search", () => {
    renderPanel();
    expect(panel()).toHaveAccessibleDescription(
      "New cards go to the end of your dashboard. Move them from their menu."
    );
    const search = screen.getByRole("searchbox", { name: "Search widgets" });
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(search).toHaveAccessibleDescription("5 widgets");
  });

  it("lists the groups in order, the removed cards first with their count", () => {
    renderPanel();
    expect(
      within(panel())
        .getAllByRole("heading", { level: 3 })
        .map(heading => heading.textContent)
    ).toEqual(["Removed from your dashboard 1", "Overview", "Team", "Plugins"]);
    expect(within(panel()).getByText("By plugin.")).toBeInTheDocument();
  });

  it("folds a plugin's widgets under a button until it is opened", async () => {
    const user = userEvent.setup();
    renderPanel();
    const toggle = within(panel()).getByRole("button", { name: /SEO/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Add SEO score" })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Add SEO score" })
    ).toBeInTheDocument();
  });
});

describe("each row's control", () => {
  it("names the widget it adds, and says what is already on the dashboard", () => {
    renderPanel();
    expect(
      screen.getByRole("button", { name: "Add Entries" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add another Recent activity" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add back Old notes" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("add-panel-row-core/recent")).toHaveTextContent(
      "½ to Full wide · 2 on your dashboard"
    );
    const team = screen.getByTestId("add-panel-row-core/team");
    expect(team).toHaveTextContent("On dashboard");
    expect(within(team).queryByRole("button")).toBeNull();
  });

  it("says where an added card went, and keeps the pressed button focused", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const add = screen.getByRole("button", {
      name: "Add another Recent activity",
    });
    await user.click(add);

    expect(props.onAdd).toHaveBeenCalledWith("core/recent");
    expect(live()).toHaveTextContent("Added Entries at position 4 of 4.");
    expect(add).toHaveFocus();
  });

  it("says a removed card came back, and where", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(
      screen.getByRole("button", { name: "Add back Old notes" })
    );

    expect(props.onAddBack).toHaveBeenCalledWith("p9");
    expect(live()).toHaveTextContent(
      "Added back Old notes at position 2 of 4."
    );
  });

  it("says nothing was added when the dashboard refused it", async () => {
    const user = userEvent.setup();
    renderPanel({ onAdd: vi.fn(() => null) });
    await user.click(screen.getByRole("button", { name: "Add Entries" }));
    expect(live()).toHaveTextContent(
      `Your dashboard holds the most cards it can (${MAX_PLACEMENTS}, counting removed ones). Nothing was added.`
    );
  });

  it("at the limit, disables adding but not adding back, and says why", () => {
    renderPanel({ atCapacity: true });
    expect(screen.getByRole("button", { name: "Add Entries" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add another Recent activity" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add back Old notes" })
    ).toBeEnabled();
    const notice = screen.getByTestId("add-panel-at-capacity");
    expect(notice).toHaveTextContent(
      `Your dashboard holds the most cards it can (${MAX_PLACEMENTS}, counting removed ones), so no new card can be added. A removed card can still be put back.`
    );
    // Removing a card frees nothing, since removed cards are counted, so the notice never
    // sends the reader to do that.
    expect(notice).not.toHaveTextContent(/Remove a card/);
  });
});

describe("searching", () => {
  it("keeps what matches by name, description, category, group or plugin, and opens folded groups", () => {
    renderPanel();
    const search = screen.getByRole("searchbox", { name: "Search widgets" });

    fireEvent.change(search, { target: { value: "seo" } });
    expect(screen.getByTestId("add-panel-count")).toHaveTextContent(
      "1 result for “seo”"
    );
    expect(
      screen.getByRole("button", { name: "Add SEO score" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("add-panel-row-core/entries")).toBeNull();

    fireEvent.change(search, { target: { value: "CONTENT" } });
    expect(
      screen.getByTestId("add-panel-row-core/entries")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("add-panel-row-seo/score")).toBeNull();
  });

  it("announces the count once typing pauses, not on every key", () => {
    vi.useFakeTimers();
    renderPanel();
    const search = screen.getByRole("searchbox", { name: "Search widgets" });

    fireEvent.change(search, { target: { value: "en" } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(search, { target: { value: "entr" } });
    act(() => vi.advanceTimersByTime(300));
    expect(live().textContent).toBe("");

    act(() => vi.advanceTimersByTime(200));
    expect(live()).toHaveTextContent("1 result for “entr”.");
  });

  it("never lets a count still waiting on a pause speak over an add made before it", () => {
    // 🔴 The add keeps the query and its count, so nothing else clears the waiting count, and
    // it landed half a second later on top of "Added".
    vi.useFakeTimers();
    renderPanel();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search widgets" }),
      {
        target: { value: "entr" },
      }
    );
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole("button", { name: "Add Entries" }));
    expect(live()).toHaveTextContent("Added Entries at position 4 of 4.");

    act(() => vi.advanceTimersByTime(1000));
    expect(live()).toHaveTextContent("Added Entries at position 4 of 4.");
  });

  it("says when nothing matches, and Clear search brings every widget back", async () => {
    const user = userEvent.setup();
    renderPanel();
    const search = screen.getByRole("searchbox", { name: "Search widgets" });
    await user.type(search, "zzz");

    expect(screen.getByTestId("add-panel-none")).toHaveTextContent(
      "No widgets match “zzz”"
    );
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByTestId("add-panel-count")).toHaveTextContent(
      "5 widgets"
    );
    expect(live()).toHaveTextContent("5 widgets.");
  });
});

describe("closing", () => {
  it("closes from its button", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts with an empty search each time it opens", async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      rows: ROWS,
      atCapacity: false,
      onAdd: vi.fn(() => null),
      onAddBack: vi.fn(() => null),
      onClosed: vi.fn(),
    };
    const { rerender } = render(<AddWidgetPanel {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "seo" },
    });
    rerender(<AddWidgetPanel {...props} open={false} />);
    // The dialog hands focus back once it has unmounted, a tick after it closes.
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledTimes(1));
    rerender(<AddWidgetPanel {...props} open />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
