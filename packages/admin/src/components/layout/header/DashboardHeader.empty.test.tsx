// @vitest-environment jsdom
/**
 * Below the width where the icon rail shows, the phone header already holds
 * the logo and the menu, so the top bar is drawn only while it has something
 * to show: a page's trail, or the toggle of a page that folds its panel.
 * Without either it would be an empty band under the phone header. From that
 * width up the bar stays on every page. jsdom evaluates no CSS, so the
 * narrow-only hiding is read from its class.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChromeSuppressionProvider } from "../ChromeSuppression";
import { PanelFoldProvider, useFoldedPanel } from "../PanelFold";

import { DashboardHeader } from "./DashboardHeader";
import { HeaderTrailProvider, useHeaderTrail } from "./HeaderTrail";

function TrailPage(): React.JSX.Element {
  useHeaderTrail({
    steps: [{ label: "Blog posts", href: "/admin/collections/posts" }],
    current: "Spring is here",
  });
  return <p>editor</p>;
}

function FoldingPage(): React.JSX.Element {
  useFoldedPanel("forms.builder");
  return <p>builder</p>;
}

function renderBar(page?: React.ReactNode) {
  return render(
    <ChromeSuppressionProvider>
      <PanelFoldProvider>
        <HeaderTrailProvider>
          <DashboardHeader />
          {page}
        </HeaderTrailProvider>
      </PanelFoldProvider>
    </ChromeSuppressionProvider>
  );
}

const bar = () => screen.getByRole("banner");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the top bar below the rail's width", () => {
  it("is not drawn on a page that gives it nothing to show", () => {
    renderBar(<p>dashboard</p>);
    expect(bar().className).toContain("max-lg:hidden");
    expect(bar()).toHaveAttribute("data-empty", "true");
  });

  it("is drawn on a page that puts a trail in it", () => {
    renderBar(<TrailPage />);
    expect(bar().className).not.toContain("max-lg:hidden");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  });

  it("is drawn on a page that folds its panel, for the toggle", () => {
    renderBar(<FoldingPage />);
    expect(bar().className).not.toContain("max-lg:hidden");
    expect(
      screen.getByRole("button", { name: /show the panel|hide the panel/i })
    ).toBeTruthy();
  });
});
