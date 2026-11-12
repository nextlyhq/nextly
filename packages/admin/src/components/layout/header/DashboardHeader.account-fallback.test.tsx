// @vitest-environment jsdom
/**
 * The Inbox and the account menu live at the rail's foot. A surface that
 * takes the rail away but keeps the top bar (translation mode does) would
 * take them with it, so while the rail is suppressed the bar draws them at
 * its right end instead, and only then: with the rail there, they are not
 * drawn twice.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressAdminChrome,
} from "../ChromeSuppression";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
}));
vi.mock("../sidebar/RailAccount", () => ({
  RailAccount: ({ placement }: { placement?: string }) => (
    <div data-testid="account" data-placement={placement} />
  ),
}));

import { DashboardHeader } from "./DashboardHeader";

/** Takes the rail and its panel away and keeps the bar, as translation mode does. */
function RailTakingSurface(): React.JSX.Element {
  useSuppressAdminChrome({
    layers: ["primaryRail", "subSidebar"],
    canExit: true,
  });
  return <p>surface</p>;
}

afterEach(cleanup);

describe("the Inbox and account menu in the top bar", () => {
  it("are drawn at the bar's right end while the rail is suppressed", () => {
    render(
      <ChromeSuppressionProvider>
        <DashboardHeader />
        <RailTakingSurface />
      </ChromeSuppressionProvider>
    );
    const account = screen.getByTestId("account");
    expect(screen.getByRole("banner")).toContainElement(account);
    expect(account).toHaveAttribute("data-placement", "bar");
  });

  it("are not drawn in the bar while the rail is there", () => {
    render(
      <ChromeSuppressionProvider>
        <DashboardHeader />
      </ChromeSuppressionProvider>
    );
    expect(screen.queryByTestId("account")).toBeNull();
  });
});
