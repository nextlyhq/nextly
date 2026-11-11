/**
 * The greeting row's one place: what a part of the page renders there is drawn
 * at the row's end, wherever in the page it was rendered, and where its owner
 * says when the page has no row to draw into.
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

  it("draws the action through withoutRow on a page with no greeting row, as when a plugin replaced the greeting", () => {
    render(
      <GreetingActionProvider>
        <header data-testid="bar" />
        <section data-testid="grid">
          <GreetingAction
            withoutRow={action => <div data-testid="fallback">{action}</div>}
          >
            <Action />
          </GreetingAction>
        </section>
      </GreetingActionProvider>
    );
    expect(screen.getByTestId("fallback")).toContainElement(
      screen.getByRole("button", { name: "Customize dashboard" })
    );
  });

  it("moves the action into the row when a row arrives later", () => {
    const page = (withRow: boolean) => (
      <GreetingActionProvider>
        {withRow ? <GreetingActionTarget /> : null}
        <section data-testid="grid">
          <GreetingAction>
            <Action />
          </GreetingAction>
        </section>
      </GreetingActionProvider>
    );
    const view = render(page(false));
    expect(screen.getByTestId("grid")).toContainElement(
      screen.getByRole("button", { name: "Customize dashboard" })
    );
    view.rerender(page(true));
    expect(screen.getByTestId("dashboard-greeting-action")).toContainElement(
      screen.getByRole("button", { name: "Customize dashboard" })
    );
    expect(within(screen.getByTestId("grid")).queryByRole("button")).toBeNull();
  });
});
