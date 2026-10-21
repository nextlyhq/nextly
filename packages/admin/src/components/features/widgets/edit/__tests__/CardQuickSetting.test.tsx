/**
 * The quick setting drawn on a card: it saves at once, shows the choice straight away, goes back
 * when the save does not land, and leaves a small card's header to its menu.
 */
import { act, render, screen } from "@testing-library/react";
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
  options: [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
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
