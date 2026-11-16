/**
 * The stepper as a reader and a screen-reader user meet it: an ordered list
 * whose current step carries `aria-current="step"`, steps before it marked
 * done in words as well as with a tick, and a done step that offers a way back
 * as a real link or button, which a current or upcoming step never does.
 *
 * @module components/ui/__tests__/stepper.test
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { Stepper } from "../stepper";

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (href: string) => navigateTo(href),
}));

const steps = [
  { label: "Choose the source", href: "/import/source" },
  { label: "Match the fields", href: "/import/fields" },
  { label: "Check the result", href: "/import/check" },
];

/** Each step's list item, in order. */
function items(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Steps" })).getAllByRole(
    "listitem"
  );
}

describe("Stepper", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks only the current step with aria-current=step", () => {
    render(<Stepper steps={steps} current={1} />);
    const [first, second, third] = items();
    expect(first).not.toHaveAttribute("aria-current");
    expect(second).toHaveAttribute("aria-current", "step");
    expect(third).not.toHaveAttribute("aria-current");
    // Each says which state it is in, for styling and for tests.
    expect(items().map(item => item.dataset.state)).toEqual([
      "complete",
      "current",
      "upcoming",
    ]);
  });

  it("says a done step is done in words, not only with a tick", () => {
    render(<Stepper steps={steps} current={2} />);
    const [first, second, third] = items();
    expect(first).toHaveTextContent("Choose the source (done)");
    expect(second).toHaveTextContent("Match the fields (done)");
    expect(third).not.toHaveTextContent("(done)");
    // Upcoming and current steps show their number.
    expect(third).toHaveTextContent("3");
  });

  it("links back only from done steps", async () => {
    const user = userEvent.setup();
    render(<Stepper steps={steps} current={1} />);
    const [first, second, third] = items();
    const back = within(first).getByRole("link", { name: /Choose the source/ });
    expect(back).toHaveAttribute("href", "/import/source");
    // The current and upcoming steps are text, whatever href they carry.
    expect(within(second).queryByRole("link")).toBeNull();
    expect(within(third).queryByRole("link")).toBeNull();
    await user.click(back);
    expect(navigateTo).toHaveBeenCalledWith("/import/source");
  });

  it("runs a done step's handler from a button, by keyboard as well", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Stepper
        steps={[
          { label: "Choose", onSelect },
          { label: "Connect", onSelect: vi.fn() },
        ]}
        current={1}
      />
    );
    const [first, second] = items();
    const back = within(first).getByRole("button", { name: /Choose/ });
    back.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(within(second).queryByRole("button")).toBeNull();
  });

  it("draws plain text for a done step with no way back", () => {
    render(
      <Stepper
        steps={[{ label: "Choose" }, { label: "Connect" }]}
        current={1}
      />
    );
    expect(within(items()[0]).queryByRole("link")).toBeNull();
    expect(within(items()[0]).queryByRole("button")).toBeNull();
  });

  it("names the list as the page says", () => {
    render(<Stepper aria-label="Import steps" steps={steps} current={0} />);
    expect(
      screen.getByRole("list", { name: "Import steps" })
    ).toBeInTheDocument();
  });

  it("marks every step done once current is past the last", () => {
    render(<Stepper steps={steps} current={3} />);
    expect(items().map(item => item.dataset.state)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    items().forEach(item => expect(item).not.toHaveAttribute("aria-current"));
  });
});
