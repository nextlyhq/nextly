/**
 * The greeting row's one place: what a part of the page renders there is drawn
 * at the row's end, wherever in the page it was rendered, and where it stands
 * when there is no row to draw into.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  GreetingAction,
  GreetingActionProvider,
  GreetingActionTarget,
} from "./GreetingAction";

function Action() {
  return <button type="button">Customize dashboard</button>;
}

describe("the greeting row's action place", () => {
  it("draws the action in the row, not where it was rendered", () => {
    render(
      <GreetingActionProvider>
        <div data-testid="row">
          <h1>Good morning, Ada</h1>
          <GreetingActionTarget />
        </div>
        {/* A sibling part of the page, as the widget grid is. */}
        <section data-testid="grid">
          <GreetingAction>
            <Action />
          </GreetingAction>
        </section>
      </GreetingActionProvider>
    );
    const action = screen.getByRole("button", { name: "Customize dashboard" });
    expect(screen.getByTestId("dashboard-greeting-action")).toContainElement(
      action
    );
    expect(within(screen.getByTestId("grid")).queryByRole("button")).toBeNull();
  });

  it("draws the action where it stands outside the dashboard page", () => {
    render(
      <section data-testid="grid">
        <GreetingAction>
          <Action />
        </GreetingAction>
      </section>
    );
    expect(screen.getByTestId("grid")).toContainElement(
      screen.getByRole("button", { name: "Customize dashboard" })
    );
  });

  it("draws nothing while the page has no greeting row to draw into", () => {
    render(
      <GreetingActionProvider>
        <section data-testid="grid">
          <GreetingAction>
            <Action />
          </GreetingAction>
        </section>
      </GreetingActionProvider>
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
