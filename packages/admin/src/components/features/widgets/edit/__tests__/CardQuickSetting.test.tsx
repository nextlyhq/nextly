/**
 * The quick setting drawn on a card: it saves at once, shows the choice straight away, goes back
 * when the save does not land, and leaves a small card's header to its menu.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { CardQuickSetting } from "../CardQuickSetting";
import type { QuickSetting } from "../quick-setting";

const RANGE: QuickSetting = {
  name: "range",
  type: "select",
  label: "Date range",
  quick: true,
  // Three: a choice of exactly two is drawn as a segmented control instead (below).
  options: [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Last 90 days", value: "90d" },
  ],
};

/** A choice of exactly two, as Continue where you left off's tab is. */
const TAB: QuickSetting = {
  name: "tab",
  type: "select",
  label: "Show",
  quick: true,
  options: [
    { label: "Mine", value: "mine" },
    { label: "Team", value: "team" },
  ],
};

function at(tier: "small" | "medium") {
  return ({ children }: { children: ReactNode }) => (
    <CardTierContext.Provider value={tier}>{children}</CardTierContext.Provider>
  );
}

describe("a card's quick setting", () => {
  it("names the card it changes, and saves a choice at once", async () => {
    const onChange = vi.fn();
    render(
      <CardQuickSetting
        setting={RANGE}
        value="30d"
        cardTitle="Activity"
        disabled={false}
        onChange={onChange}
      />,
      { wrapper: at("medium") }
    );
    const control = screen.getByRole("combobox", {
      name: "Date range for Activity",
    });
    expect(control.textContent).toContain("Last 30 days");
    await userEvent.click(control);
    await userEvent.click(screen.getByRole("option", { name: "Last 7 days" }));
    expect(onChange).toHaveBeenCalledWith("7d", expect.any(Function));
    expect(control.textContent).toContain("Last 7 days");
  });

  it("goes back to the stored value when the save does not land", async () => {
    let revert: () => void = () => {};
    render(
      <CardQuickSetting
        setting={RANGE}
        value="30d"
        cardTitle="Activity"
        disabled={false}
        onChange={(_next, reverted) => {
          revert = reverted;
        }}
      />,
      { wrapper: at("medium") }
    );
    const control = screen.getByRole("combobox", {
      name: "Date range for Activity",
    });
    await userEvent.click(control);
    await userEvent.click(screen.getByRole("option", { name: "Last 7 days" }));
    expect(control.textContent).toContain("Last 7 days");
    act(() => revert());
    expect(control.textContent).toContain("Last 30 days");
  });

  it("is not drawn in a small card's header, where the card's menu offers it", () => {
    render(
      <CardQuickSetting
        setting={RANGE}
        value="30d"
        cardTitle="Activity"
        disabled={false}
        onChange={vi.fn()}
      />,
      { wrapper: at("small") }
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("cannot be changed while another write is in flight", () => {
    render(
      <CardQuickSetting
        setting={RANGE}
        value="30d"
        cardTitle="Activity"
        disabled
        onChange={vi.fn()}
      />,
      { wrapper: at("medium") }
    );
    expect(
      screen
        .getByRole("combobox", { name: "Date range for Activity" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("a quick choice of two", () => {
  function drawTab(
    props: Partial<Parameters<typeof CardQuickSetting>[0]> = {}
  ) {
    const onChange = vi.fn();
    render(
      <CardQuickSetting
        setting={TAB}
        value="mine"
        cardTitle="Continue where you left off"
        disabled={false}
        onChange={onChange}
        {...props}
      />,
      { wrapper: at("medium") }
    );
    const group = screen.getByRole("radiogroup", {
      name: "Show for Continue where you left off",
    });
    const radio = (name: string) => within(group).getByRole("radio", { name });
    return { onChange, group, radio };
  }

  it("is a radio group of both choices naming its card, where three choices are the menu", () => {
    const { group, radio } = drawTab();
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(radio("Mine")).toBeTruthy();
    expect(radio("Team")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("marks the chosen one, and puts only it in the tab order", async () => {
    const { group, radio } = drawTab();
    expect(radio("Mine").getAttribute("aria-checked")).toBe("true");
    expect(radio("Team").getAttribute("aria-checked")).toBe("false");
    expect(
      within(group)
        .getAllByRole("radio")
        .filter(each => each.tabIndex === 0)
    ).toEqual([radio("Mine")]);
    // Tab reaches the chosen radio, and the next Tab leaves the group.
    await userEvent.tab();
    expect(document.activeElement).toBe(radio("Mine"));
    await userEvent.tab();
    expect(group.contains(document.activeElement)).toBe(false);
  });

  it("moves to the other choice and chooses it with the arrows, Home and End, saving each", async () => {
    const { onChange, radio } = drawTab();
    await userEvent.tab();

    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("team", expect.any(Function));
    expect(document.activeElement).toBe(radio("Team"));
    expect(radio("Team").getAttribute("aria-checked")).toBe("true");
    expect(radio("Team").tabIndex).toBe(0);
    expect(radio("Mine").tabIndex).toBe(-1);

    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("mine", expect.any(Function));
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("team", expect.any(Function));
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("mine", expect.any(Function));
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("team", expect.any(Function));
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("mine", expect.any(Function));
    expect(document.activeElement).toBe(radio("Mine"));
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it("saves a click as the menu does, and goes back when the save does not land", async () => {
    let revert: () => void = () => {};
    const onChange = vi.fn((_next: unknown, reverted: () => void) => {
      revert = reverted;
    });
    const { radio } = drawTab({ onChange });
    await userEvent.click(radio("Team"));
    expect(onChange).toHaveBeenCalledWith("team", expect.any(Function));
    expect(radio("Team").getAttribute("aria-checked")).toBe("true");
    act(() => revert());
    expect(radio("Mine").getAttribute("aria-checked")).toBe("true");
    // Choosing the one already chosen saves nothing.
    await userEvent.click(radio("Mine"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("cannot be changed while the setting cannot be, as the menu cannot", async () => {
    const { onChange, radio } = drawTab({ disabled: true });
    expect(radio("Mine").hasAttribute("disabled")).toBe(true);
    expect(radio("Team").hasAttribute("disabled")).toBe(true);
    await userEvent.click(radio("Team"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is not drawn in a small card's header", () => {
    render(
      <CardQuickSetting
        setting={TAB}
        value="mine"
        cardTitle="Continue where you left off"
        disabled={false}
        onChange={vi.fn()}
      />,
      { wrapper: at("small") }
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
