/**
 * The More settings panel as a reader meets it: beside a dashboard that stays usable, its
 * settings in Data, Display and Advanced, Advanced folded, the card's own title kept on Done, the
 * filter edited as chips joined with AND, a change of collection saying what it reset, and a leave
 * with changes still in the panel asked first.
 *
 * The branding context stands in for the workspace payload's `widgetSources`; everything else is
 * the real panel.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnyWidgetSetting, PublishedContentSource } from "nextly/config";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  requestSettingsPanel,
  SettingsPanel,
  type PanelKept,
} from "../SettingsPanel";

const sources: PublishedContentSource[] = [
  {
    collection: "posts",
    label: "Posts",
    lifecycle: false,
    fields: [
      { name: "title", type: "string", label: "Title" },
      { name: "views", type: "number", label: "Views" },
    ],
  },
  {
    collection: "pages",
    label: "Pages",
    lifecycle: false,
    fields: [{ name: "title", type: "string", label: "Title" }],
  },
];

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ widgetSources: sources }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const LIST: AnyWidgetSetting[] = [
  { name: "collection", type: "collection", label: "Collection" },
  { name: "where", type: "filter", of: "collection", label: "Filter" },
  { name: "sort", type: "sort", of: "collection", label: "Sort" },
  { name: "limit", type: "number", label: "Number of items", defaultValue: 5 },
  {
    name: "density",
    type: "select",
    label: "Density",
    defaultValue: "default",
    options: [
      { label: "Default", value: "default" },
      { label: "Compact", value: "compact" },
    ],
    section: "advanced",
  },
];

/** The panel over `settings`, with the dashboard's own button beside it. */
function panel(
  config: Record<string, unknown> | undefined,
  settings: AnyWidgetSetting[] = LIST,
  ownTitle?: string
) {
  const onDone = vi.fn((_kept: PanelKept, settled: { saved: () => void }) =>
    settled.saved()
  );
  const onOpenChange = vi.fn();
  render(
    <>
      <button type="button">On the dashboard</button>
      <SettingsPanel
        placementId="p1"
        open
        onOpenChange={onOpenChange}
        title="Recent posts"
        settings={settings}
        config={config}
        ownTitle={ownTitle}
        onDone={onDone}
      />
    </>
  );
  return { onDone, onOpenChange };
}

const kept = (onDone: ReturnType<typeof panel>["onDone"]) =>
  onDone.mock.calls.at(-1)?.[0];

describe("the More settings panel beside the dashboard", () => {
  it("leaves the dashboard usable: nothing behind it hidden, and a click there keeps the panel open", async () => {
    const { onOpenChange } = panel({ collection: "posts" });
    // A modal panel withdraws the page from the accessibility tree, so this query finds nothing.
    const outside = screen.getByRole("button", { name: "On the dashboard" });
    expect(outside.closest("[aria-hidden='true']")).toBeNull();
    await userEvent.click(outside);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("dialog", { name: "Recent posts settings" })
    ).toBeTruthy();
  });
});

describe("the panel's sections", () => {
  it("draws Data and Display open, and Advanced folded until opened", async () => {
    panel({ collection: "posts" });
    expect(screen.getByRole("region", { name: "Data" })).toHaveTextContent(
      /Collection.*Filter.*Sort/s
    );
    const display = screen.getByRole("region", { name: "Display" });
    expect(within(display).getByLabelText("Title")).toBeTruthy();
    expect(display).toHaveTextContent("Number of items");
    const advanced = screen.getByRole("button", { name: "Advanced" });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Density")).toBeNull();
    await userEvent.click(advanced);
    expect(screen.getByText("Density")).toBeTruthy();
  });

  it("draws only what the widget declares: no Data or Advanced for a card with neither", () => {
    panel(undefined, [
      {
        name: "limit",
        type: "number",
        label: "Number of items",
        defaultValue: 5,
      },
    ]);
    expect(screen.queryByRole("region", { name: "Data" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
    expect(screen.getByRole("region", { name: "Display" })).toBeTruthy();
  });
});

describe("the card's own title", () => {
  it("is kept on Done, trimmed, beside the settings", async () => {
    const { onDone } = panel({ collection: "posts" });
    await userEvent.type(screen.getByLabelText("Title"), "  Drafts to finish ");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(kept(onDone)).toEqual({
      config: { collection: "posts" },
      ownTitle: "Drafts to finish",
    });
  });

  it("refuses a title longer than a card's header holds, counted in characters", async () => {
    const { onDone } = panel({ collection: "posts" });
    const title = screen.getByLabelText("Title");
    await userEvent.click(title);
    // Eighty emoji are 160 UTF-16 units and still fit: one more does not.
    await userEvent.paste("😀".repeat(81));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByText("A title can be at most 80 characters.")
    ).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.clear(title);
    await userEvent.paste("😀".repeat(80));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("goes back to automatic with Display's Reset", async () => {
    const { onDone } = panel({ collection: "posts" }, LIST, "Mine");
    expect(screen.getByLabelText("Title")).toHaveValue("Mine");
    await userEvent.click(
      screen.getByRole("button", { name: "Reset Display to defaults" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(kept(onDone)?.ownTitle).toBe("");
  });
});

describe("the panel's filter chips", () => {
  /** Adds one condition on `field` holding `value`, as a reader does. */
  async function addFilter(field: string, value: string) {
    await userEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await userEvent.click(
      screen.getByRole("combobox", { name: "Condition field" })
    );
    await userEvent.click(screen.getByRole("option", { name: field }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Condition value" }),
      value
    );
  }

  it("draws each condition as a chip and joins several with AND", async () => {
    const { onDone } = panel({ collection: "posts" });
    await addFilter("Title", "Hello");
    await addFilter("Title", "World");
    expect(screen.getByRole("button", { name: "Title is Hello" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Title is World" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(kept(onDone)?.config.where).toEqual({
      and: [{ title: { equals: "Hello" } }, { title: { equals: "World" } }],
    });
  });

  it("refuses a chip begun and not finished, until it is finished or removed", async () => {
    const { onDone } = panel({ collection: "posts" });
    await userEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await userEvent.click(
      screen.getByRole("combobox", { name: "Condition field" })
    );
    await userEvent.click(screen.getByRole("option", { name: "Title" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByText("Finish this filter, or remove it.")
    ).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove this filter" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("removes one chip alone with its ✕", async () => {
    const { onDone } = panel({
      collection: "posts",
      where: {
        and: [{ title: { equals: "Hello" } }, { title: { equals: "World" } }],
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Remove filter: Title is Hello" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(kept(onDone)?.config.where).toEqual({
      title: { equals: "World" },
    });
  });

  it("offers only the fields of the chosen collection the reader is offered", async () => {
    panel({ collection: "pages" });
    await userEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await userEvent.click(
      screen.getByRole("combobox", { name: "Condition field" })
    );
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Title"]);
  });
});

describe("a change of collection", () => {
  it("says beside the Collection which settings it reset, by name", async () => {
    panel({
      collection: "posts",
      where: { views: { greater_than: 5 } },
      sort: "-views",
    });
    await userEvent.click(screen.getByRole("combobox", { name: /Collection/ }));
    await userEvent.click(screen.getByRole("option", { name: "Pages" }));
    expect(
      await screen.findByText("Changing the collection reset Filter and Sort")
    ).toHaveAttribute("role", "status");
  });

  it("says nothing when it reset nothing a reader had chosen", async () => {
    // The control: nothing over the collection was set, so a notice here would name settings
    // that changed nothing.
    panel({ collection: "posts" });
    await userEvent.click(screen.getByRole("combobox", { name: /Collection/ }));
    await userEvent.click(screen.getByRole("option", { name: "Pages" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: /Collection/ })
      ).toHaveTextContent("Pages")
    );
    expect(screen.queryByText(/Changing the collection reset/)).toBeNull();
  });
});

describe("leaving with changes still in the panel", () => {
  it("asks first, through the admin's own unsaved-changes prompt", async () => {
    panel({ collection: "posts" });
    await userEvent.type(screen.getByLabelText("Title"), "Mine");
    act(() => window.history.pushState(null, "", "/admin/elsewhere"));
    const prompt = await screen.findByRole("alertdialog");
    expect(prompt).toHaveTextContent("Unsaved Changes");
  });

  it("lets the reader leave a panel that holds no change", async () => {
    // The control: the same leave, from a panel holding nothing, asks nothing.
    panel({ collection: "posts" });
    act(() => window.history.pushState(null, "", "/admin/elsewhere-again"));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("one settings panel at a time", () => {
  /** Two cards' panels, the first open, and the second card's way in, as the card's menu has. */
  function TwoPanels() {
    const [first, setFirst] = useState(true);
    const [second, setSecond] = useState(false);
    const done = (_kept: PanelKept, settled: { saved: () => void }) =>
      settled.saved();
    return (
      <>
        <button
          type="button"
          onClick={() => requestSettingsPanel("second", () => setSecond(true))}
        >
          Open the second card's settings
        </button>
        <SettingsPanel
          placementId="first"
          open={first}
          onOpenChange={setFirst}
          title="First card"
          settings={LIST}
          config={{ collection: "posts" }}
          onDone={done}
        />
        <SettingsPanel
          placementId="second"
          open={second}
          onOpenChange={setSecond}
          title="Second card"
          settings={LIST}
          config={{ collection: "posts" }}
          onDone={done}
        />
      </>
    );
  }

  const second = () =>
    screen.queryByRole("dialog", { name: "Second card settings" });

  it("asks about a panel holding a change first, and opens no second panel over it", async () => {
    render(<TwoPanels />);
    await userEvent.type(screen.getByLabelText("Title"), "Mine");
    await userEvent.click(
      screen.getByRole("button", { name: "Open the second card's settings" })
    );
    const prompt = await screen.findByRole("alertdialog");
    expect(prompt).toHaveTextContent("Unsaved Changes");
    expect(prompt).toHaveTextContent("First card");
    expect(second()).toBeNull();
    // Discarded, the first closes and the second opens: still one at a time.
    await userEvent.click(
      within(prompt).getByRole("button", { name: "Discard Changes" })
    );
    await waitFor(() => expect(second()).toBeTruthy());
    expect(
      screen.queryByRole("dialog", { name: "First card settings" })
    ).toBeNull();
  });

  it("closes a panel holding nothing for the one opened", async () => {
    // The control: nothing to lose, so nothing is asked.
    render(<TwoPanels />);
    await userEvent.click(
      screen.getByRole("button", { name: "Open the second card's settings" })
    );
    await waitFor(() => expect(second()).toBeTruthy());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "First card settings" })
    ).toBeNull();
  });
});
